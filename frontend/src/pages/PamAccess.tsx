import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { DURATIONS, JitGrant, jitApi, timeLeft, vaultApi } from "../pamAccessApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import { EmptyState, PageHeader, tableWrap, theadCls } from "../components/ui";
import { dateTime } from "../time";

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";
const btn = "inline-flex h-8 items-center rounded border border-slate-700 px-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40";

const TONE: Record<string, string> = {
  pending: "bg-amber-400/15 text-amber-300",
  approved: "bg-emerald-400/15 text-emerald-300",
  denied: "bg-red-400/15 text-red-300",
  revoked: "bg-slate-500/20 text-slate-300",
  expired: "bg-slate-500/20 text-slate-400",
};

/**
 * Just-in-time access: a user asks for one asset or vault entry for a limited time, an approver accepts,
 * and the access ends on its own when the time is up. With zero standing privileges on, nobody can open a
 * remote session, inject a vault secret or check a secret out without such a grant.
 */
export default function PamAccess() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const L = (en: string, a: string) => (az ? a : en);
  const { confirm, toast } = useFeedback();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["jit"], queryFn: jitApi.state, refetchInterval: 15_000 });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const vault = useQuery({ queryKey: ["vault"], queryFn: vaultApi.list });
  const [busy, setBusy] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["jit"] });
  const d = state.data;
  const canApprove = !!d?.can_approve;

  const groups = useMemo(() => {
    const g = d?.grants ?? [];
    return {
      pending: g.filter((x) => x.status === "pending"),
      active: g.filter((x) => x.status === "approved"),
      history: g.filter((x) => x.status !== "pending" && x.status !== "approved").slice(0, 50),
    };
  }, [d]);

  const act = async (id: string, work: () => Promise<unknown>, done: string) => {
    setBusy(id);
    try {
      await work();
      toast(done, "success");
      await refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const togglePolicy = async () => {
    if (!d) return;
    const next = !d.policy.required;
    const ok = await confirm({
      title: next ? L("Turn on zero standing privileges", "Sıfır daimi imtiyazı aktivləşdir") : L("Turn off zero standing privileges", "Sıfır daimi imtiyazı söndür"),
      message: next
        ? L("From now on, remote sessions, credential injection and vault check-outs need an approved just-in-time grant, for every user including administrators. Sessions without a grant cannot be opened.", "Bundan sonra uzaq sessiyalar, etimad ötürülməsi və seyfdən götürmə üçün təsdiqlənmiş müvəqqəti icazə lazımdır, administratorlar da daxil olmaqla. İcazəsiz sessiya açmaq olmaz.")
        : L("Operators can again open sessions and check out secrets without a grant.", "Operatorlar yenidən icazəsiz sessiya aça və sirr götürə biləcək."),
      confirmLabel: next ? L("Turn on", "Aktivləşdir") : L("Turn off", "Söndür"),
      cancelLabel: L("Cancel", "Ləğv et"),
      danger: !next,
    });
    if (ok) await act("policy", () => jitApi.setPolicy(next), L("Policy saved", "Siyasət saxlanıldı"));
  };

  const row = (g: JitGrant, actions: React.ReactNode) => (
    <tr key={g.id} className="hover:bg-slate-900/60">
      <td className="px-4 py-2 text-slate-100">{g.username}</td>
      <td className="px-4 py-2">
        <div className="text-slate-100">{g.target_name}</div>
        <div className="text-xs text-slate-500">{g.target_type === "asset" ? L("Asset", "Aktiv") : L("Vault entry", "Seyf qeydi")}</div>
      </td>
      <td className="max-w-xs px-4 py-2 text-xs text-slate-300"><div className="line-clamp-2" title={g.reason}>{g.reason}</div></td>
      <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-300">
        {g.status === "approved" && g.expires_at ? (
          <span className="text-emerald-300">{L("ends in", "bitir")} {timeLeft(g.expires_at)}<span className="block text-slate-500">{dateTime(g.expires_at)}</span></span>
        ) : g.status === "pending" ? (
          `${g.minutes < 60 ? `${g.minutes} min` : `${g.minutes / 60} h`} · ${L("asked", "istənib")} ${dateTime(g.requested_at)}`
        ) : (
          <span>{dateTime(g.decided_at ?? g.requested_at)}{g.decided_by ? ` · ${g.decided_by}` : ""}{g.revoked_by ? ` · ${L("revoked by", "ləğv edən")} ${g.revoked_by}` : ""}</span>
        )}
      </td>
      <td className="px-4 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[g.status] ?? TONE.expired}`}>{g.status}</span>
        {g.self_approved && <span className="ml-1 text-[11px] text-amber-300" title={L("Approved by the requester", "Sorğu sahibi özü təsdiqləyib")}>{L("self", "özü")}</span>}
      </td>
      <td className="whitespace-nowrap px-4 py-2 text-right">{actions}</td>
    </tr>
  );

  const table = (rows: JitGrant[], actions: (g: JitGrant) => React.ReactNode) => (
    <div className={tableWrap}>
      <table className="w-full text-left text-sm">
        <thead className={theadCls}>
          <tr>
            <th className="px-4 py-2.5 font-medium">{L("User", "İstifadəçi")}</th>
            <th className="px-4 py-2.5 font-medium">{L("Access to", "Giriş")}</th>
            <th className="px-4 py-2.5 font-medium">{L("Reason", "Səbəb")}</th>
            <th className="px-4 py-2.5 font-medium">{L("Time", "Vaxt")}</th>
            <th className="px-4 py-2.5 font-medium">{L("Status", "Vəziyyət")}</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">{rows.map((g) => row(g, actions(g)))}</tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={L("Just-in-time access", "Müvəqqəti giriş (JIT)")}
        subtitle={L(
          "Ask for access to one asset or vault entry for a limited time. An approver accepts it, and the access ends by itself when the time is up: live sessions are disconnected and checked-out secrets stop being shown.",
          "Bir aktivə və ya seyf qeydinə məhdud müddətə giriş istəyin. Təsdiqləyən qəbul edir və vaxt bitəndə giriş özü sona çatır: aktiv sessiyalar kəsilir, götürülmüş sirlər artıq göstərilmir.",
        )}
      />
      {state.error && <p className="text-red-400">{(state.error as Error).message}</p>}
      {d && (
        <>
          <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 ${d.policy.required ? "border-emerald-700/60 bg-emerald-950/20" : "border-slate-800 bg-slate-900/60"}`}>
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-slate-100">
                {L("Zero standing privileges", "Sıfır daimi imtiyaz")}: {d.policy.required ? <span className="text-emerald-300">{L("on", "aktivdir")}</span> : <span className="text-slate-400">{L("off", "söndürülüb")}</span>}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {d.policy.required
                  ? L("Nobody holds permanent access. Remote sessions, credential injection and vault check-outs need an approved grant, and end with it.", "Heç kimin daimi girişi yoxdur. Uzaq sessiya, etimad ötürülməsi və seyfdən götürmə üçün təsdiqlənmiş icazə lazımdır və onunla birlikdə bitir.")
                  : L("Operators can open sessions and check out secrets at any time. Turn this on to require a just-in-time grant for every access.", "Operatorlar istənilən vaxt sessiya aça və sirr götürə bilər. Hər giriş üçün müvəqqəti icazə tələb etmək üçün aktivləşdirin.")}
              </p>
            </div>
            {canApprove && (
              <button onClick={togglePolicy} disabled={busy === "policy"} className={d.policy.required ? btn : "rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"}>
                {d.policy.required ? L("Turn off", "Söndür") : L("Turn on", "Aktivləşdir")}
              </button>
            )}
          </div>

          <RequestForm
            az={az}
            assets={(assets.data ?? []).map((a) => ({ id: String(a.id), name: `${a.name} (${a.host})` }))}
            entries={(vault.data ?? []).map((v) => ({ id: v.id, name: v.name }))}
            onSubmit={async (body) => {
              await jitApi.request(body);
              toast(canApprove ? L("Requested. Approve it below.", "İstənildi. Aşağıda təsdiqləyin.") : L("Requested. An approver will decide.", "İstənildi. Təsdiqləyən qərar verəcək."), "success");
              await refresh();
            }}
          />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">{L("Waiting for approval", "Təsdiq gözləyir")} ({groups.pending.length})</h2>
            {groups.pending.length === 0 ? <p className="text-xs text-slate-500">{L("Nothing waiting.", "Gözləyən yoxdur.")}</p> : table(groups.pending, (g) => (
              <div className="inline-flex gap-1.5">
                {canApprove && <button onClick={() => act(g.id, () => jitApi.approve(g.id), L("Approved", "Təsdiqləndi"))} disabled={busy === g.id} className="inline-flex h-8 items-center rounded bg-emerald-700 px-2 text-xs text-white hover:bg-emerald-600 disabled:opacity-40">{L("Approve", "Təsdiqlə")}</button>}
                {canApprove && <button onClick={() => act(g.id, () => jitApi.deny(g.id), L("Denied", "Rədd edildi"))} disabled={busy === g.id} className={`${btn} text-red-300`}>{L("Deny", "Rədd et")}</button>}
                {!canApprove && g.user_id === user?.id && <button onClick={() => act(g.id, () => jitApi.revoke(g.id), L("Withdrawn", "Geri götürüldü"))} disabled={busy === g.id} className={btn}>{L("Withdraw", "Geri götür")}</button>}
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">{L("Active access", "Aktiv giriş")} ({groups.active.length})</h2>
            {groups.active.length === 0 ? <p className="text-xs text-slate-500">{L("No active grants.", "Aktiv icazə yoxdur.")}</p> : table(groups.active, (g) => (
              (canApprove || g.user_id === user?.id) && (
                <button onClick={() => act(g.id, () => jitApi.revoke(g.id), L("Revoked; live sessions end within 15 seconds", "Ləğv edildi; aktiv sessiyalar 15 saniyə ərzində bitir"))} disabled={busy === g.id} className={`${btn} text-red-300`}>
                  {g.user_id === user?.id ? L("End now", "İndi bitir") : L("Revoke", "Ləğv et")}
                </button>
              )
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-200">{L("History", "Tarixçə")}</h2>
            {groups.history.length === 0 ? <EmptyState title={L("No past requests", "Keçmiş sorğu yoxdur")} /> : table(groups.history, () => null)}
          </section>
        </>
      )}
    </div>
  );
}

function RequestForm({ az, assets, entries, onSubmit }: { az: boolean; assets: { id: string; name: string }[]; entries: { id: string; name: string }[]; onSubmit: (b: { target_type: "asset" | "vault"; target_id: string; minutes: number; reason: string }) => Promise<void> }) {
  const L = (en: string, a: string) => (az ? a : en);
  const [type, setType] = useState<"asset" | "vault">("asset");
  const [target, setTarget] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const options = type === "asset" ? assets : entries;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ target_type: type, target_id: target, minutes, reason: reason.trim() });
      setReason("");
      setTarget("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-sm font-semibold text-slate-200">{L("Request access", "Giriş istə")}</h2>
      <div className="grid gap-3 md:grid-cols-[10rem_1fr_9rem]">
        <label className="block text-sm"><span className="text-slate-400">{L("To", "Nəyə")}</span>
          <select className={field} value={type} onChange={(e) => { setType(e.target.value as "asset" | "vault"); setTarget(""); }}>
            <option value="asset">{L("Asset", "Aktiv")}</option>
            <option value="vault">{L("Vault entry", "Seyf qeydi")}</option>
          </select>
        </label>
        <label className="block text-sm"><span className="text-slate-400">{type === "asset" ? L("Asset", "Aktiv") : L("Vault entry", "Seyf qeydi")}</span>
          <select className={field} value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="" disabled>{L("Choose...", "Seçin...")}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="block text-sm"><span className="text-slate-400">{L("For", "Müddət")}</span>
          <select className={field} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm"><span className="text-slate-400">{L("Reason", "Səbəb")}</span>
        <input className={field} value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder={L("e.g. INC-1234: patch OpenSSH on web01", "məs. INC-1234: web01-də OpenSSH yeniləməsi")} />
      </label>
      {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
      <div className="flex justify-end">
        <button type="submit" disabled={saving || !target} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
          {saving ? "..." : L("Send request", "Sorğu göndər")}
        </button>
      </div>
    </form>
  );
}
