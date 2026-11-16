import { FormEvent, useState } from "react";
import type { Asset, AssetInput, Connection, OsType } from "../types";
import { useI18n } from "../i18n";

interface Props {
  initial: Asset | null;
  onSave: (body: AssetInput) => Promise<void>;
  onClose: () => void;
}

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500";

function toPort(value: string, fallback: number | null): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
}

export default function AssetModal({ initial, onSave, onClose }: Props) {
  const { t, lang } = useI18n();
  const az = lang === "az";
  const [connection, setConnection] = useState<Connection>(initial?.connection ?? "agent");
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "");
  const [osType, setOsType] = useState<OsType>(initial?.os_type ?? "linux");
  const [osVersion, setOsVersion] = useState(initial?.os_version ?? "");
  const [ssh, setSsh] = useState(String(initial?.ssh_port ?? 22));
  const [rdp, setRdp] = useState(String(initial?.rdp_port ?? 3389));
  const [winrm, setWinrm] = useState(String(initial?.winrm_port ?? 5985));
  const [winrmHttps, setWinrmHttps] = useState(String(initial?.winrm_https_port ?? 5986));
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        host: host.trim(),
        os_type: osType,
        os_version: osVersion.trim() || null,
        ssh_port: toPort(ssh, 22),
        rdp_port: toPort(rdp, 3389),
        winrm_port: toPort(winrm, 5985),
        winrm_https_port: toPort(winrmHttps, 5986),
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        connection: osType === "linux" && connection === "winrm" ? "ssh" : connection,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("asset.saveFail"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">{initial ? t("asset.edit") : t("assets.add")}</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-slate-300">{t("col.name")}</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t("asset.ip")}</span>
            <input className={field} value={host} onChange={(e) => setHost(e.target.value)} required maxLength={255} />
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t("asset.osType")}</span>
            <select className={field} value={osType} onChange={(e) => setOsType(e.target.value as OsType)}>
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t("asset.osVersion")}</span>
            <input className={field} value={osVersion} onChange={(e) => setOsVersion(e.target.value)} placeholder="Ubuntu 24.04" />
          </label>
        </div>

        <label className="block text-sm">
          <span className="text-slate-300">{az ? "Skan və möhkəmləndirmə üsulu" : "Scan and hardening method"}</span>
          <select className={field} value={osType === "linux" && connection === "winrm" ? "ssh" : connection} onChange={(e) => setConnection(e.target.value as Connection)}>
            <option value="agent">{az ? "Quraşdırılmış agent" : "Installed agent"}</option>
            <option value="ssh">{az ? "Agentsiz: SSH" : "Agentless: SSH"}</option>
            {osType === "windows" && <option value="winrm">{az ? "Agentsiz: WinRM" : "Agentless: WinRM"}</option>}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            {connection === "agent"
              ? az ? "Agent hostda daim işləyir və core-a özü qoşulur." : "The agent runs on the host all the time and connects to core by itself."
              : az ? "Core saxlanılan etimad məlumatı ilə daxil olur və agenti yalnız iş zamanı işə salır. Hostun core-a şəbəkə yolu lazım deyil. RDP yalnız interaktiv sessiya üçündür." : "Core signs in with the stored credential and runs the agent only while there is work. The host needs no network route to core. RDP stays for interactive sessions only."}
          </span>
        </label>

        <fieldset className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <legend className="mb-2 text-sm text-slate-300">{t("asset.ports")}</legend>
          <label className="text-xs text-slate-400">SSH
            <input className={field} value={ssh} onChange={(e) => setSsh(e.target.value)} inputMode="numeric" />
          </label>
          <label className="text-xs text-slate-400">RDP
            <input className={field} value={rdp} onChange={(e) => setRdp(e.target.value)} inputMode="numeric" />
          </label>
          <label className="text-xs text-slate-400">WinRM HTTP
            <input className={field} value={winrm} onChange={(e) => setWinrm(e.target.value)} inputMode="numeric" />
          </label>
          <label className="text-xs text-slate-400">WinRM HTTPS
            <input className={field} value={winrmHttps} onChange={(e) => setWinrmHttps(e.target.value)} inputMode="numeric" />
          </label>
        </fieldset>
        <p className="text-xs text-slate-500">{t("asset.portsNote")}</p>

        <label className="block text-sm">
          <span className="text-slate-300">{t("asset.tags")}</span>
          <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="web, prod" />
        </label>

        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={saving} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
            {saving ? t("asset.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
