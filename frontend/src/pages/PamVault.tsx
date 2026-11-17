import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { DURATIONS, timeLeft, vaultApi, VaultEntry, VaultInput, VaultType } from "../pamAccessApi";
import type { SessionOpenResult } from "../sessionTypes";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import { openSession } from "../components/openSession";
import RemoteSession from "../components/RemoteSession";
import { EmptyState, PageHeader, searchCls, tableWrap, theadCls } from "../components/ui";
import { dateTime } from "../time";

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";
const btn = "inline-flex h-8 items-center rounded border border-slate-700 px-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40";

const TYPE_LABEL: Record<VaultType, [string, string]> = {
  password: ["Password", "Parol"],
  ssh_key: ["SSH key", "SSH açarı"],
  certificate: ["Certificate", "Sertifikat"],
  api_key: ["API key", "API açarı"],
};

/**
 * Password vault: privileged passwords, SSH keys, certificates and API keys, sealed on the server.
 * Secrets are never listed. A user checks an entry out to see it, and only until the check-out ends;
 * password and SSH key entries linked to an asset can open a recorded session with the secret injected.
 */
export default function PamVault() {
  const { can } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const L = (en: string, a: string) => (az ? a : en);
  const { confirm, toast } = useFeedback();
  const queryClient = useQueryClient();
  const canManage = can("vault.manage");
  const vault = useQuery({ queryKey: ["vault"], queryFn: vaultApi.list, refetchInterval: 15_000 });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const [editing, setEditing] = useState<VaultEntry | "new" | null>(null);
  const [checkingOut, setCheckingOut] = useState<VaultEntry | null>(null);
  const [revealed, setRevealed] = useState<{ entry: VaultEntry; secret: string; expires_at: string } | null>(null);
  const [live, setLive] = useState<SessionOpenResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["vault"] });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (vault.data ?? []).filter((v) => !needle || `${v.name} ${v.username} ${v.asset_name ?? ""} ${v.type}`.toLowerCase().includes(needle));
  }, [vault.data, q]);

  const run = async (id: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await work();
      if (done) toast(done, "success");
      await refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const connect = (v: VaultEntry) =>
    run(v.id, async () => {
      const asset = (assets.data ?? []).find((a) => a.id === v.asset_id);
      if (!asset) throw new Error(L("The linked asset no longer exists", "Bağlı aktiv artıq mövcud deyil"));
      const session = await openSession(asset, confirm, az, L("Cancel", "Ləğv et"), v.id);
      if (session) setLive(session);
    });

  const reveal = (v: VaultEntry) => run(v.id, async () => setRevealed({ entry: v, ...(await vaultApi.secret(v.id)) }));

  const remove = async (v: VaultEntry) => {
    const ok = await confirm({ title: L("Delete vault entry", "Seyf qeydini sil"), message: `${v.name}: ${L("the stored secret is deleted and cannot be recovered.", "saxlanılan sirr silinir və bərpa olunmur.")}`, confirmLabel: L("Delete", "Sil"), cancelLabel: L("Cancel", "Ləğv et"), danger: true });
    if (ok) await run(v.id, () => vaultApi.remove(v.id), L("Entry deleted", "Qeyd silindi"));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={L("Password vault", "Parol seyfi")}
        subtitle={L(
          "Privileged passwords, SSH keys, certificates and API keys, encrypted on the server. Connect injects a linked secret into a recorded session without showing it. To see a secret, check it out; it is checked back in automatically when the time ends.",
          "İmtiyazlı parollar, SSH açarları, sertifikatlar və API açarları serverdə şifrələnmiş saxlanılır. Qoşul bağlı sirri göstərmədən yazılan sessiyaya ötürür. Sirri görmək üçün onu götürün; vaxt bitəndə avtomatik qaytarılır.",
        )}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input type="search" className={searchCls} placeholder={L("Search name, user or asset", "Ad, istifadəçi və ya aktiv axtar")} value={q} onChange={(e) => setQ(e.target.value)} />
        {canManage && (
          <button onClick={() => setEditing("new")} className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500">
            {L("Add entry", "Qeyd əlavə et")}
          </button>
        )}
      </div>
      {vault.error && <p className="text-red-400">{(vault.error as Error).message}</p>}
      {vault.data && rows.length === 0 ? (
        <EmptyState
          title={L("No vault entries", "Seyfdə qeyd yoxdur")}
          hint={canManage ? L("Add a password, SSH key, certificate or API key.", "Parol, SSH açarı, sertifikat və ya API açarı əlavə edin.") : L("Ask a vault manager to add entries.", "Qeyd əlavə etmək üçün seyf menecerinə müraciət edin.")}
        />
      ) : (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-2.5 font-medium">{L("Name", "Ad")}</th>
                <th className="px-4 py-2.5 font-medium">{L("Type", "Növ")}</th>
                <th className="px-4 py-2.5 font-medium">{L("Account", "Hesab")}</th>
                <th className="px-4 py-2.5 font-medium">{L("Asset", "Aktiv")}</th>
                <th className="px-4 py-2.5 font-medium">{L("Status", "Vəziyyət")}</th>
                <th className="px-4 py-2.5 text-right font-medium">{L("Actions", "Əməliyyatlar")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((v) => {
                const injectable = v.asset_id && (v.type === "password" || v.type === "ssh_key");
                const lockedByOther = v.checked_out && !v.mine;
                return (
                  <tr key={v.id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-2">
                      <div className="font-medium text-slate-100">{v.name}</div>
                      {v.notes && <div className="max-w-xs truncate text-xs text-slate-500" title={v.notes}>{v.notes}</div>}
                    </td>
                    <td className="px-4 py-2"><span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{L(...TYPE_LABEL[v.type])}</span></td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-300">{v.username || "-"}</td>
                    <td className="px-4 py-2 text-xs text-slate-300">{v.asset_name ?? "-"}</td>
                    <td className="px-4 py-2 text-xs">
                      {v.checked_out ? (
                        <span className={v.mine ? "text-cyan-300" : "text-amber-300"} title={v.checkout_reason}>
                          {v.mine ? L("Checked out by you", "Sizdədir") : `${L("Checked out by", "Götürüb:")} ${v.checked_out_by}`} · {L("ends in", "bitir")} {timeLeft(v.checkout_expires_at)}
                        </span>
                      ) : (
                        <span className="text-emerald-300">{L("Available", "Mövcuddur")}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {injectable && (
                          <button onClick={() => connect(v)} disabled={busy === v.id} className="inline-flex h-8 items-center rounded bg-cyan-700 px-2 text-xs text-white hover:bg-cyan-600 disabled:opacity-40" title={L("Recorded session with this secret injected; you never see it", "Bu sirr ötürülməklə yazılan sessiya; siz onu görmürsünüz")}>
                            {L("Connect", "Qoşul")}
                          </button>
                        )}
                        {v.mine ? (
                          <>
                            <button onClick={() => reveal(v)} disabled={busy === v.id} className={btn}>{L("Show secret", "Sirri göstər")}</button>
                            <button onClick={() => run(v.id, () => vaultApi.checkin(v.id), L("Checked in", "Qaytarıldı"))} disabled={busy === v.id} className={btn}>{L("Check in", "Qaytar")}</button>
                          </>
                        ) : (
                          <button onClick={() => setCheckingOut(v)} disabled={lockedByOther || busy === v.id} className={btn} title={lockedByOther ? L("Another user holds it", "Başqa istifadəçidədir") : undefined}>
                            {L("Check out", "Götür")}
                          </button>
                        )}
                        {canManage && lockedByOther && (
                          <button onClick={() => run(v.id, () => vaultApi.checkin(v.id), L("Checked in", "Qaytarıldı"))} className={btn}>{L("Force check-in", "Məcburi qaytar")}</button>
                        )}
                        {canManage && (
                          <>
                            <button onClick={() => setEditing(v)} className={btn}>{L("Edit", "Redaktə")}</button>
                            <button onClick={() => remove(v)} className={`${btn} text-red-300`}>{L("Delete", "Sil")}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <VaultModal
          entry={editing === "new" ? null : editing}
          assets={(assets.data ?? []).map((a) => ({ id: a.id, name: `${a.name} (${a.host})` }))}
          az={az}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            if (editing === "new") await vaultApi.create(body);
            else await vaultApi.update(editing.id, body);
            setEditing(null);
            toast(L("Saved", "Saxlanıldı"), "success");
            await refresh();
          }}
        />
      )}
      {checkingOut && (
        <CheckoutModal
          entry={checkingOut}
          az={az}
          onClose={() => setCheckingOut(null)}
          onSave={async (minutes, reason) => {
            await vaultApi.checkout(checkingOut.id, minutes, reason);
            setCheckingOut(null);
            toast(L("Checked out. Use Show secret to see it.", "Götürüldü. Görmək üçün Sirri göstər basın."), "success");
            await refresh();
          }}
        />
      )}
      {revealed && <SecretModal {...revealed} az={az} onClose={() => setRevealed(null)} />}
      {live && <RemoteSession session={live} onClose={() => setLive(null)} />}
    </div>
  );
}

function Modal({ title, note, children, onSubmit }: { title: string; note?: string; children: React.ReactNode; onSubmit?: (e: FormEvent) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={onSubmit} className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
        </div>
        {children}
      </form>
    </div>
  );
}

function Actions({ az, onClose, saving, label }: { az: boolean; onClose: () => void; saving?: boolean; label?: string }) {
  return (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">{label ? (az ? "Ləğv et" : "Cancel") : az ? "Bağla" : "Close"}</button>
      {label && (
        <button type="submit" disabled={saving} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50">{label}</button>
      )}
    </div>
  );
}

function VaultModal({ entry, assets, az, onSave, onClose }: { entry: VaultEntry | null; assets: { id: number; name: string }[]; az: boolean; onSave: (b: VaultInput) => Promise<void>; onClose: () => void }) {
  const L = (en: string, a: string) => (az ? a : en);
  const [form, setForm] = useState<VaultInput>({ name: entry?.name ?? "", type: entry?.type ?? "password", username: entry?.username ?? "", asset_id: entry?.asset_id ?? 0, secret: "", notes: entry?.notes ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<VaultInput>) => setForm((f) => ({ ...f, ...patch }));
  const linkable = form.type === "password" || form.type === "ssh_key";
  const multiline = form.type === "ssh_key" || form.type === "certificate";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({ ...form, name: form.name.trim(), asset_id: linkable ? form.asset_id : 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={entry ? L("Edit vault entry", "Seyf qeydini redaktə et") : L("Add vault entry", "Seyfə qeyd əlavə et")} note={L("The secret is encrypted on the server and never shown here again.", "Sirr serverdə şifrələnir və burada bir daha göstərilmir.")} onSubmit={submit}>
      <label className="block text-sm"><span className="text-slate-300">{L("Name", "Ad")}</span>
        <input className={field} value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} placeholder={L("e.g. web01 root", "məs. web01 root")} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm"><span className="text-slate-300">{L("Type", "Növ")}</span>
          <select className={field} value={form.type} onChange={(e) => set({ type: e.target.value as VaultType })}>
            {(Object.keys(TYPE_LABEL) as VaultType[]).map((k) => <option key={k} value={k}>{L(...TYPE_LABEL[k])}</option>)}
          </select>
        </label>
        <label className="block text-sm"><span className="text-slate-300">{L("Account", "Hesab")}</span>
          <input className={field} value={form.username} onChange={(e) => set({ username: e.target.value })} maxLength={255} placeholder="root" />
        </label>
      </div>
      {linkable && (
        <label className="block text-sm"><span className="text-slate-300">{L("Linked asset (for Connect)", "Bağlı aktiv (Qoşul üçün)")}</span>
          <select className={field} value={form.asset_id} onChange={(e) => set({ asset_id: Number(e.target.value) })}>
            <option value={0}>{L("None", "Yoxdur")}</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <label className="block text-sm"><span className="text-slate-300">{L("Secret", "Sirr")}{entry ? ` (${L("leave empty to keep the current one", "cari sirri saxlamaq üçün boş buraxın")})` : ""}</span>
        {multiline ? (
          <textarea className={`${field} h-32 font-mono text-xs`} value={form.secret} onChange={(e) => set({ secret: e.target.value })} required={!entry} spellCheck={false} />
        ) : (
          <input type="password" className={field} value={form.secret} onChange={(e) => set({ secret: e.target.value })} required={!entry} autoComplete="new-password" />
        )}
      </label>
      <label className="block text-sm"><span className="text-slate-300">{L("Notes", "Qeydlər")}</span>
        <textarea className={`${field} h-16`} value={form.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} />
      </label>
      {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
      <Actions az={az} onClose={onClose} saving={saving} label={saving ? L("Saving...", "Saxlanılır...") : L("Save", "Saxla")} />
    </Modal>
  );
}

function CheckoutModal({ entry, az, onSave, onClose }: { entry: VaultEntry; az: boolean; onSave: (minutes: number, reason: string) => Promise<void>; onClose: () => void }) {
  const L = (en: string, a: string) => (az ? a : en);
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(minutes, reason.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title={`${L("Check out", "Götür")}: ${entry.name}`} note={L("Only you can see the secret until you check it in or the time ends. The check-out is recorded in the audit log.", "Qaytarana və ya vaxt bitənə qədər sirri yalnız siz görə bilərsiniz. Götürmə audit jurnalına yazılır.")} onSubmit={submit}>
      <label className="block text-sm"><span className="text-slate-300">{L("For how long", "Nə qədər müddətə")}</span>
        <select className={field} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
          {DURATIONS.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
        </select>
      </label>
      <label className="block text-sm"><span className="text-slate-300">{L("Reason", "Səbəb")}</span>
        <textarea className={`${field} h-20`} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder={L("e.g. ticket INC-1234: restart database", "məs. INC-1234: verilənlər bazasını yenidən başlatmaq")} />
      </label>
      {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
      <Actions az={az} onClose={onClose} saving={saving} label={saving ? "..." : L("Check out", "Götür")} />
    </Modal>
  );
}

/** Shows a checked-out secret masked by default, and closes itself when the check-out ends. */
function SecretModal({ entry, secret, expires_at, az, onClose }: { entry: VaultEntry; secret: string; expires_at: string; az: boolean; onClose: () => void }) {
  const L = (en: string, a: string) => (az ? a : en);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const ms = new Date(expires_at).getTime() - Date.now();
    const timer = window.setTimeout(onClose, Math.max(0, Math.min(ms, 5 * 60_000)));
    return () => window.clearTimeout(timer);
  }, [expires_at, onClose]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setShown(true);
    }
  };
  return (
    <Modal title={entry.name} note={`${entry.username ? `${L("Account", "Hesab")}: ${entry.username} · ` : ""}${L("Check-out ends", "Götürmə bitir")} ${dateTime(expires_at)}. ${L("This window closes after 5 minutes.", "Bu pəncərə 5 dəqiqədən sonra bağlanır.")}`}>
      <pre className={`max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs ${shown ? "text-slate-100" : "select-none text-transparent [text-shadow:0_0_8px_rgba(148,163,184,0.9)]"}`}>{secret}</pre>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShown(!shown)} className={btn}>{shown ? L("Hide", "Gizlət") : L("Show", "Göstər")}</button>
        <button type="button" onClick={copy} className={btn}>{copied ? L("Copied", "Kopyalandı") : L("Copy", "Kopyala")}</button>
      </div>
      <Actions az={az} onClose={onClose} />
    </Modal>
  );
}
