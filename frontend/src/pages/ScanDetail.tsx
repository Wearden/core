import { Fragment, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scansApi } from "../scansApi";
import { useScanSocket } from "../hooks/useScanSocket";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";
import CopilotPanel from "../components/CopilotPanel";
import AiAnalysisPanel from "../components/AiAnalysisPanel";
import ControlInfo from "../components/ControlInfo";

const SEVERITY_STYLE: Record<string, string> = {
  low: "text-slate-400",
  medium: "text-amber-300",
  high: "text-orange-300",
  critical: "text-red-300 font-semibold",
};

function scoreText(v: number | null): string {
  return v === null ? "—" : `${v.toFixed(1)}%`;
}

export default function ScanDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const { connected, feed } = useScanSocket(id);

  const scan = useQuery({
    queryKey: ["scan", id],
    queryFn: () => scansApi.get(id!),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const [hostFilter, setHostFilter] = useState<number | "">("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openRow, setOpenRow] = useState<number | null>(null);

  const results = useQuery({
    queryKey: ["scan-results", id, hostFilter, statusFilter, scan.data?.done_checks],
    queryFn: () => scansApi.results(id!, hostFilter === "" ? undefined : hostFilter, statusFilter || undefined),
    enabled: !!id,
  });

  const cancel = useMutation({
    mutationFn: () => scansApi.cancel(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["scan", id] }),
  });

  if (scan.error) return <p className="text-red-400">{t("scan.notFound")}</p>;
  const s = scan.data;
  if (!s) return <p className="text-slate-400">{t("common.loading")}</p>;

  const pct = s.total_checks ? Math.round((s.done_checks / s.total_checks) * 100) : 0;
  const scanBenchmark = s.benchmark_id;
  const finished = ["completed", "cancelled", "failed"].includes(s.status);
  const field = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";
  // Shows a translated explanation, or nothing when there is no text for that status.
  const explain = (key: string) => {
    const text = t(key);
    return text === key ? null : text;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/scans" className="text-sm text-slate-400 hover:text-slate-200">{t("scan.allScans")}</Link>
          <h1 className="mt-1 text-2xl font-bold">{s.name}</h1>
          <p className="text-sm text-slate-400">
            {s.profile_name} · {s.host_count} {t("scan.hostsCount")} ·{" "}
            <span className={connected ? "text-emerald-400" : "text-amber-400"}>{connected ? t("scan.live") : t("scan.reconnecting")}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={s.status} />
          {canOperate && !finished && (
            <button onClick={() => cancel.mutate()} disabled={cancel.isPending} className="rounded-md border border-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/50">
              {t("scan.cancel")}
            </button>
          )}
        </div>
      </div>

      <div>
        <div className="h-3 w-full overflow-hidden rounded bg-slate-800">
          <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-sm text-slate-400">
          {s.done_checks} {t("scan.of")} {s.total_checks} {t("scan.checks")} · {pct}%
        </div>
        {s.message && <p className="mt-2 text-sm text-red-300">{s.message}</p>}
      </div>

      {finished && s.status === "completed" && <AiAnalysisPanel scanId={id!} benchmarkId={scanBenchmark} />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {s.hosts.map((h) => (
          <div key={h.id} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                {h.asset_id ? (
                  <Link to={`/hosts/${h.asset_id}`} className="font-semibold text-cyan-300 hover:underline">{h.asset_name}</Link>
                ) : (
                  <div className="font-semibold">{h.asset_name}</div>
                )}
                <div className="font-mono text-xs text-slate-500">{h.host}</div>
              </div>
              <StatusPill status={h.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-slate-400">{t("scan.compliance")}</div>
                <div className="text-2xl font-semibold text-cyan-300">{scoreText(h.score)}</div>
              </div>
              <div>
                <div className="text-slate-400">{t("scan.weighted")}</div>
                <div className="text-2xl font-semibold text-cyan-300">{scoreText(h.weighted_score)}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <span className="text-emerald-300">{h.passed} {t("scan.pass")}</span>
              <span className="text-red-300">{h.failed} {t("scan.fail")}</span>
              <span className="text-amber-300">{h.errored} {t("scan.error")}</span>
              <span className="text-slate-400">{h.not_applicable} {t("scan.na")}</span>
            </div>
            {h.message && <p className="mt-2 text-xs text-amber-300">{h.message}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{t("scan.results")}</h2>
            <select className={field} value={hostFilter} onChange={(e) => setHostFilter(e.target.value === "" ? "" : Number(e.target.value))} aria-label="host filter">
              <option value="">{t("scan.allHosts")}</option>
              {s.hosts.map((h) => (
                <option key={h.id} value={h.id}>{h.asset_name}</option>
              ))}
            </select>
            <select className={field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="status filter">
              <option value="">{t("scan.allStatuses")}</option>
              <option value="fail">{t("status.fail")}</option>
              <option value="pass">{t("status.pass")}</option>
              <option value="error">{t("scan.errorOpt")}</option>
              <option value="not_applicable">{t("scan.notApplicable")}</option>
            </select>
          </div>
          <p className="text-xs text-slate-500">{t("scan.clickHint")}</p>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-3 py-2">{t("col.host")}</th>
                  <th className="px-3 py-2">{t("col.control")}</th>
                  <th className="px-3 py-2">{t("col.severity")}</th>
                  <th className="px-3 py-2">{t("col.status")}</th>
                  <th className="px-3 py-2">{t("col.actualExpected")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {(results.data ?? []).map((r) => (
                  <Fragment key={r.id}>
                    <tr key={r.id} className="cursor-pointer align-top hover:bg-slate-900/60" onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                      <td className="px-3 py-2 text-xs">{r.asset_name}</td>
                      <td className="px-3 py-2">
                        <div>{r.title}</div>
                        <div className="text-xs text-slate-500">
                          <span className="font-mono">{r.control_id}</span>
                          {r.category && <span> · {r.category}</span>}
                        </div>
                      </td>
                      <td className={`px-3 py-2 text-xs ${SEVERITY_STYLE[r.severity] ?? ""}`}>{r.severity}</td>
                      <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                      <td className="px-3 py-2 text-xs">
                        <div className="text-slate-300">{t("scan.found")} <span className="break-all font-mono">{r.actual ?? "—"}</span></div>
                        <div className="text-slate-500">{t("scan.expected")} <span className="break-all font-mono">{r.expected}</span></div>
                      </td>
                    </tr>
                    {openRow === r.id && (
                      <tr className="bg-slate-900/40">
                        <td />
                        <td colSpan={4} className="px-3 py-3 text-xs">
                          {explain(`scan.exp.${r.status}`) && <p className="mb-2 text-slate-300">{explain(`scan.exp.${r.status}`)}</p>}
                          {r.message && <p className="mb-2 text-amber-200">{r.message}</p>}
                          <div className="mb-3">
                            <ControlInfo benchmarkId={scanBenchmark} controlId={r.control_id} />
                          </div>
                          {r.status === "fail" && (
                            <div className="mb-3">
                              <CopilotPanel benchmarkId={scanBenchmark} controlId={r.control_id} />
                            </div>
                          )}
                          <div className="text-slate-400">{t("scan.rawOutput")} ({r.duration_ms} ms)</div>
                          <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-slate-300">{r.raw_output ?? t("scan.noOutput")}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {results.data && results.data.length === 0 && <p className="text-sm text-slate-400">{t("scan.noResults")}</p>}
        </section>

        <aside className="space-y-3">
          <h2 className="text-lg font-semibold">{t("scan.liveFeed")}</h2>
          <ol className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs">
            {feed.length === 0 && <li className="text-slate-500">{t("scan.waiting")}</li>}
            {[...feed].reverse().map((l) => (
              <li key={l.key} className="flex items-start gap-2">
                <StatusPill status={l.status} />
                <span className="min-w-0 flex-1">
                  <span className="text-slate-200">{l.title}</span>
                  <span className="block text-slate-500">{l.hostName} · {l.durationMs} ms</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>
    </div>
  );
}
