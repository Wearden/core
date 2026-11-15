import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hardeningApi, shortId } from "../hardeningApi";
import { benchmarksApi } from "../benchmarksApi";
import ControlInfo from "../components/ControlInfo";
import { useHardeningSocket } from "../hooks/useHardeningSocket";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";

const STATUS_STYLE: Record<string, string> = {
  applied: "bg-emerald-900/60 text-emerald-200",
  reverted: "bg-slate-800 text-slate-200",
  skipped: "bg-slate-800 text-slate-300",
  failed: "bg-red-900/70 text-red-200",
  revert_failed: "bg-red-900/70 text-red-200",
  auto_rolled_back: "bg-amber-900/60 text-amber-200",
  lockout_unresolved: "bg-red-900/80 text-red-100 font-semibold",
  pending: "bg-slate-800 text-slate-300",
  applying: "bg-cyan-900/70 text-cyan-200",
};

export default function HardeningRun() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const { connected, log } = useHardeningSocket(id);
  const run = useQuery({ queryKey: ["run", id], queryFn: () => hardeningApi.run(id!), enabled: !!id, refetchInterval: 5_000 });
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [rollbackName, setRollbackName] = useState("");

  // Control titles, so the table shows what each control is and not only its ID.
  const benchmarkId = run.data?.benchmark_id;
  const controls = useQuery({
    queryKey: ["controls", benchmarkId],
    queryFn: () => benchmarksApi.controls(benchmarkId!),
    enabled: !!benchmarkId,
    staleTime: Infinity,
    retry: false,
  });
  const titleOf = new Map((controls.data ?? []).map((c) => [c.id, c.title]));

  const cancel = useMutation({ mutationFn: () => hardeningApi.cancel(id!), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["run", id] }) });
  const rollback = useMutation({
    mutationFn: (ids?: number[]) => hardeningApi.rollback(id!, ids, rollbackName.trim() || undefined),
    onSuccess: () => {
      setPicked(new Set());
      setRollbackName("");
      queryClient.invalidateQueries({ queryKey: ["rollbacks"] });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["run", id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("hr.rollbackFail")),
  });

  if (run.error) return <p className="text-red-400">{t("hr.notFound")}</p>;
  const r = run.data;
  if (!r) return <p className="text-slate-400">{t("common.loading")}</p>;

  const applied = r.changes.filter((c) => c.status === "applied");
  const finished = ["completed", "cancelled", "failed"].includes(r.status);
  // done_changes also counts rollback steps, so it can pass the total. Never show more than 100%.
  const done = Math.min(r.done_changes, r.total_changes);
  const pct = r.total_changes ? Math.round((done / r.total_changes) * 100) : 0;
  const counts = r.changes.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  // Shows a translated explanation, or nothing when there is no text for that status.
  const explain = (key: string) => {
    const text = t(key);
    return text === key ? null : text;
  };
  const toggle = (cid: number) => setPicked((s) => { const n = new Set(s); n.has(cid) ? n.delete(cid) : n.add(cid); return n; });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/hardening" className="text-sm text-slate-400 hover:text-slate-200">{t("hr.allRuns")}</Link>
          <h1 className="mt-1 text-2xl font-bold">{r.name}</h1>
          <p className="text-sm text-slate-400">
            <span className="font-mono text-slate-300">{shortId("H", r.id)}</span> · {r.host_count} {t("scan.hostsCount")} · {r.total_changes} {t("hr.changes")} · {t("hr.by")} {r.created_by} ·{" "}
            <span className={connected ? "text-emerald-400" : "text-amber-400"}>{connected ? t("scan.live") : t("scan.reconnecting")}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={r.status} />
          {canOperate && !finished && (
            <button onClick={() => cancel.mutate()} className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50">{t("hr.stop")}</button>
          )}
        </div>
      </div>

      <div>
        <div className="h-3 w-full overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-amber-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-sm text-slate-400">{done} {t("scan.of")} {r.total_changes} {t("hr.changes")} · {pct}%</div>
        {r.message && <p className="mt-2 text-sm text-slate-300">{r.message}</p>}
      </div>

      {r.changes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">{t("hr.summary")}:</span>
          {Object.entries(counts).map(([status, n]) => (
            <span key={status} title={explain(`hr.exp.${status}`) ?? undefined} className={`rounded px-2 py-0.5 ${STATUS_STYLE[status] ?? STATUS_STYLE.pending}`}>
              {n} {status.replace(/_/g, " ")}
            </span>
          ))}
          <span className="text-slate-500">· {t("hr.clickHint")}</span>
        </div>
      )}

      {canOperate && applied.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <span className="text-sm text-slate-300">{applied.length} {t("hr.appliedCount")}</span>
          <input
            className="w-64 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
            value={rollbackName}
            onChange={(e) => setRollbackName(e.target.value)}
            maxLength={120}
            placeholder={t("hr.rollbackNamePh")}
            aria-label={t("hr.rollbackNamePh")}
          />
          <button
            onClick={() => rollback.mutate(Array.from(picked))}
            disabled={picked.size === 0 || !finished || rollback.isPending}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800 disabled:opacity-40"
          >
            {t("hr.rollbackSel")} ({picked.size})
          </button>
          <button
            onClick={() => window.confirm(t("hr.rollbackConfirm")) && rollback.mutate(undefined)}
            disabled={!finished || rollback.isPending}
            className="rounded-md bg-red-800 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-40"
          >
            {t("hr.rollbackAll")}
          </button>
          {!finished && <span className="text-xs text-slate-500">{t("hr.whenFinished")}</span>}
          {error && <span className="text-sm text-red-300">{error}</span>}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2 overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-3 py-2" />
                <th className="px-3 py-2">{t("col.host")}</th>
                <th className="px-3 py-2">{t("col.control")}</th>
                <th className="px-3 py-2">{t("hr.beforeAfter")}</th>
                <th className="px-3 py-2">{t("hr.change")}</th>
                <th className="px-3 py-2">{t("hr.rollbackCol")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {r.changes.map((c) => (
                <Fragment key={c.id}>
                <tr className="align-top">
                  <td className="px-3 py-2">
                    {canOperate && c.status === "applied" && (
                      <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`${t("hr.rollbackSel")} ${c.control_id}`} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{c.asset_name}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenRow(openRow === c.id ? null : c.id)}
                      className="text-left hover:text-cyan-300"
                      aria-expanded={openRow === c.id}
                    >
                      <div>{titleOf.get(c.control_id) ?? c.control_id}</div>
                      <div className="font-mono text-xs text-slate-500">{c.control_id}</div>
                    </button>
                    <div className="flex gap-2 text-xs">
                      <span className="text-slate-500">{c.severity}</span>
                      {c.risky && <span className="text-red-300">{t("hard.risky")}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="text-slate-400">{t("hr.before")} <span className="break-all font-mono">{c.before_value ?? "-"}</span></div>
                    <div className="text-slate-200">{t("hr.after")} <span className="break-all font-mono">{c.after_value ?? "-"}</span></div>
                    {c.rollback_value != null && (
                      <div className="text-amber-200">{t("hr.restored")} <span className="break-all font-mono">{c.rollback_value}</span></div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_STYLE[c.status] ?? STATUS_STYLE.pending}`}>{c.status.replace(/_/g, " ")}</span>
                    {explain(`hr.exp.${c.status}`) && <div className="mt-1 max-w-xs text-xs text-slate-400">{explain(`hr.exp.${c.status}`)}</div>}
                    {c.message && <div className="mt-1 text-xs text-slate-400">{c.message}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.rollback_status ? (
                      <div className="max-w-xs">
                        <span>{t("hr.afterRollback")}: {c.rollback_status}</span>
                        {explain(`hr.rb.${c.rollback_status}`) && <div className="mt-1 text-slate-400">{explain(`hr.rb.${c.rollback_status}`)}</div>}
                      </div>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                    {c.rollback_output && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-slate-400">{t("hr.output")}</summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-slate-300">{c.rollback_output}</pre>
                      </details>
                    )}
                    {c.remediation_output && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-slate-400">{t("hr.applyOutput")}</summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-slate-300">{c.remediation_output}</pre>
                      </details>
                    )}
                  </td>
                </tr>
                {openRow === c.id && (
                  <tr className="bg-slate-900/40">
                    <td />
                    <td colSpan={5} className="px-3 py-3">
                      <ControlInfo benchmarkId={r.benchmark_id} controlId={c.control_id} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="space-y-3">
          <h2 className="text-lg font-semibold">{t("hr.liveLog")}</h2>
          <ol className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-300">
            {log.length === 0 && <li className="text-slate-500">{t("hr.waiting")}</li>}
            {log.map((l) => <li key={l.key}>{l.text}</li>)}
          </ol>
        </aside>
      </div>
    </div>
  );
}
