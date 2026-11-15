import { FormEvent, useState } from "react";
import type { Asset, CredentialInput } from "../types";
import { useI18n } from "../i18n";

interface Props {
  asset: Asset;
  onSave: (body: CredentialInput) => Promise<void>;
  onClose: () => void;
}

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500";

/** Write-only: the stored secret is never shown again. Saving replaces the previous credential. */
export default function CredentialModal({ asset, onSave, onClose }: Props) {
  const { t } = useI18n();
  const isLinux = asset.os_type === "linux";
  const [username, setUsername] = useState(asset.credential_username ?? (isLinux ? "" : "Administrator"));
  const [authType, setAuthType] = useState<"password" | "ssh_key">("password");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({ username: username.trim(), auth_type: authType, secret });
      setSecret("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cred.fail"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-lg font-semibold">{t("cred.title").replace("{name}", asset.name)}</h2>
          <p className="mt-1 text-xs text-slate-400">{t("cred.note")}</p>
        </div>
        <label className="block text-sm">
          <span className="text-slate-300">{t("login.username")}</span>
          <input className={field} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={255} />
        </label>
        {isLinux && (
          <label className="block text-sm">
            <span className="text-slate-300">{t("cred.auth")}</span>
            <select className={field} value={authType} onChange={(e) => setAuthType(e.target.value as "password" | "ssh_key")}>
              <option value="password">{t("login.password")}</option>
              <option value="ssh_key">{t("cred.pem")}</option>
            </select>
          </label>
        )}
        <label className="block text-sm">
          <span className="text-slate-300">{authType === "ssh_key" ? t("cred.privateKey") : t("login.password")}</span>
          {authType === "ssh_key" ? (
            <textarea className={`${field} h-32 font-mono text-xs`} value={secret} onChange={(e) => setSecret(e.target.value)} required />
          ) : (
            <input type="password" className={field} value={secret} onChange={(e) => setSecret(e.target.value)} required autoComplete="new-password" />
          )}
        </label>
        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={saving} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
            {saving ? t("asset.saving") : t("cred.saveBtn")}
          </button>
        </div>
      </form>
    </div>
  );
}
