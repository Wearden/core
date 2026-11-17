import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ControlResultRow, scansApi } from "../scansApi";
import { useScanSocket } from "../hooks/useScanSocket";
import { ScanFlow } from "../components/LiveFlow";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";
import CopilotPanel from "../components/CopilotPanel";
import AiAnalysisPanel from "../components/AiAnalysisPanel";
import AiBadge from "../components/AiBadge";
import { aiApi } from "../settingsApi";
import ControlInfo from "../components/ControlInfo";
import DataTable, { Column } from "../components/DataTable";
import HostIcon from "../components/HostIcon";
import { Bars, ChartCard, Legend, Ring, useChartColors } from "../components/charts";
import { Chips, PageHeader, searchCls } from "../components/ui";
import { SkeletonRows, useFeedback } from "../components/feedback";

const SEVERITY_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const SEVERITY_DOT: Record<string, string> = { critical: "bg-red-400", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-slate-500" };

function scoreText(v: number | null): string {
  return v === null ? "-" : `${v.toFixed(1)}%`;
}

type StatusFilter = "fail" | "error" | "pass" | "not_applicable" | "all";

export default function ScanDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const c = useChartColors();
  const queryClient = useQueryClient();
  const { confirm, toast } = useFeedback();
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const { connected, feed } = useScanSocket(id);

  const scan = useQuery({ queryKey: ["scan", id], queryFn: () => scansApi.get(id!), enabled: !!id, refetchInterval: 10_000 });
  // Shares its cache with the analysis panel, so a new analysis shows up in the rows at once.
  const ai = useQuery({ queryKey: ["ai-analysis", id], queryFn: () => aiApi.stored(id!), enabled: !!id, retry: false });
  const aiByControl = new Map((ai.data?.decisions ?? []).map((d) => [d.control_id, d]));
  const [hostFilter, setHostFilter] = useState<number | "">("");
  const [status, setStatus] = useState<StatusFilter>("fail");
  const [severity, setSeverity] = useState("");
  const [q, setQ] = useState("");

  const results = useQuery({
    queryKey: ["scan-results", id, hostFilter, scan.data?.done_checks],
    queryFn: () => scansApi.results(id!, hostFilter === "" ? undefined : hostFilter),
    enabled: !!id,
  });

  const cancel = useMutation({
    mutationFn: () => scansApi.cancel(id!),
    onSuccess: () => {
      toast(L("Scan cancellation requested.", "Yoxlamanın ləğvi tələb olundu."), "success");
      return queryClient.invalidateQueries({ queryKey: ["scan", id] });
    },
    onError: (e) => toast((e as Error).message, "error"),
  });

  const rows = results.data ?? [];
  const counts = useMemo(() => ({
    fail: rows.filter((r) => r.status === "fail").length,
    error: rows.filter((r) => r.status === "error").length,
    pass: rows.filter((r) => r.status === "pass").length,
    not_applicable: rows.filter((r) => r.status === "not_applicable").length,
    all: rows.length,
  }), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => (status === "all" || r.status === status) && (!severity || r.severity === severity) && (!needle || `${r.title} ${r.control_id} ${r.category} ${r.asset_name}`.toLowerCase().includes(needle)));
  }, [rows, status, severity, q]);

  const bySeverity = useMemo(
    () => ["critical", "high", "medium", "low"].map((sev) => ({ name: sev, fail: rows.filter((r) => r.severity === sev && r.status === "fail").length, error: rows.filter((r) => r.severity === sev && r.status === "error").length, pass: rows.filter((r) => r.severity === sev && r.status === "pass").length })),
    [rows],
  );

  if (scan.error) return <p className="text-red-400">{t("scan.notFound")}</p>;
  const s = scan.data;
  if (!s) return <SkeletonRows rows={6} />;

  const pct = s.total_checks ? Math.round((s.done_checks / s.total_checks) * 100) : 0;
  const finished = ["completed", "cancelled", "failed"].includes(s.status);
  const scored = s.hosts.filter((h) => h.score !== null);
  const avg = scored.length ? scored.reduce((a, h) => a + (h.score ?? 0), 0) / scored.length : null;
  const explain = (key: string) => {
    const text = t(key);
    return text === key ? null : text;
  };

  const columns: Column<ControlResultRow>[] = [
    { id: "host", header: t("col.host"), sort: (a, b) => a.asset_name.localeCompare(b.asset_name), csv: (r) => r.asset_name, cell: (r) => <span className="text-xs text-slate-300">{r.asset_name}</span>, defaultHidden: s.hosts.length < 2 },
    { id: "control", wide: true, header: t("col.control"), locked: true, sort: (a, b) => a.title.localeCompare(b.title), csv: (r) => `${r.control_id} ${r.title}`,
      cell: (r) => (<><div className="text-slate-100">{r.title}</div><div className="text-xs text-slate-500"><span className="font-mono">{r.control_id}</span>{r.category && <span> · {r.category}</span>}</div>{aiByControl.has(r.control_id) && <div className="mt-1"><AiBadge label={`AI: ${t(`ai.action.${aiByControl.get(r.control_id)!.action}`)}`} title={aiByControl.get(r.control_id)!.reason} /></div>}</>) },
    { id: "severity", header: t("col.severity"), sort: (a, b) => (SEVERITY_ORDER[a.severity] ?? 0) - (SEVERITY_ORDER[b.severity] ?? 0), csv: (r) => r.severity,
      cell: (r) => <span className="inline-flex items-center gap-1.5 text-xs text-slate-200"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[r.severity] ?? "bg-slate-500"}`} />{r.severity}</span> },
    { id: "status", header: t("col.status"), sort: (a, b) => a.status.localeCompare(b.status), csv: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    { id: "found", wrap: true, header: t("scan.found"), csv: (r) => r.actual ?? "", cell: (r) => <span className="block max-w-[14rem] truncate font-mono text-xs text-slate-400" title={r.actual ?? ""}>{r.actual ?? "-"}</span> },
    { id: "expected", wrap: true, header: t("scan.expected"), defaultHidden: true, csv: (r) => r.expected, cell: (r) => <span className="block max-w-[14rem] truncate font-mono text-xs text-slate-400" title={r.expected}>{r.expected}</span> },
    { id: "duration", header: "ms", defaultHidden: true, sort: (a, b) => a.duration_ms - b.duration_ms, csv: (r) => r.duration_ms, cell: (r) => <span className="text-xs text-slate-500">{r.duration_ms}</span> },
  ];

  return (
    <div className="space-y-6">
      <ScanFlow scan={s} feed={feed} />
      <div>
        {s.mode === "pam" ? (
          <Link to="/pam/scans" className="text-sm text-slate-500 hover:text-slate-200">{t("scan.allPamScans")}</Link>
        ) : (
          <Link to="/scans" className="text-sm text-slate-500 hover:text-slate-200">{t("scan.allScans")}</Link>
        )}
      </div>
      <PageHeader
        title={s.name}
        subtitle={`${s.profile_name} · ${s.host_count} ${t("scan.hostsCount")} · ${connected ? t("scan.live") : t("scan.reconnecting")}`}
        action={
          <div className="flex items-center gap-3">
            <StatusPill status={s.status} />
            {canOperate && !finished && (
              <button
                onClick={async () => (await confirm({ title: L("Cancel this scan?", "Bu yoxlama ləğv edilsin?"), message: L("Checks already finished are kept.", "Bitmiş yoxlamalar saxlanılır."), confirmLabel: t("scan.cancel"), cancelLabel: L("Keep running", "Davam etsin"), danger: true })) && cancel.mutate()}
                disabled={cancel.isPending}
                className="rounded-md border border-slate-700 px-3 py-2 text-sm text-red-300 hover:bg-slate-900 disabled:opacity-40"
              >
                {t("scan.cancel")}
              </button>
            )}
          </div>
        }
      />

      <div>
        {(() => {
          // Segmented by outcome: the filled part splits into pass, fail and error in proportion.
          const n = (k: "passed" | "failed" | "errored") => s.hosts.reduce((acc, h) => acc + h[k], 0);
          const parts: [string, number, string][] = [["bg-emerald-500", n("passed"), "pass"], ["bg-red-500", n("failed"), "fail"], ["bg-amber-500", n("errored"), "error"]];
          const any = parts.some(([, v]) => v > 0);
          return (
            <>
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-inset ring-white/5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="flex h-full gap-px overflow-hidden rounded-full transition-all duration-500" style={{ width: `${pct}%` }}>
                  {any ? parts.map(([c, v]) => v > 0 && <div key={c} className={`h-full ${c}`} style={{ flexGrow: v }} />) : <div className="h-full flex-1 bg-emerald-500" />}
                </div>
                {s.status === "running" && <div aria-hidden className="wd-shine absolute inset-0" />}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span className="flex flex-wrap items-center gap-3">
                  <span>{s.done_checks} {t("scan.of")} {s.total_checks} {t("scan.checks")}</span>
                  {parts.map(([c, v, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${c}`} />{label} <span className="tabular-nums text-slate-200">{v}</span></span>)}
                </span>
                <span className="text-sm font-semibold tabular-nums text-slate-100">{pct}%</span>
              </div>
            </>
          );
        })()}
        {s.message && <p className="mt-2 text-sm text-red-300">{s.message}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title={L("Overall result", "Ümumi nəticə")} subtitle={avg === null ? undefined : `${L("Average compliance", "Orta uyğunluq")} ${avg.toFixed(1)}%`}>
          <Ring
            height={170}
            centerValue={`${Math.round((counts.pass / Math.max(1, counts.pass + counts.fail + counts.error)) * 100)}%`}
            centerLabel={L("passing", "keçir")}
            data={[{ name: "pass", value: counts.pass, color: c.pass }, { name: "fail", value: counts.fail, color: c.fail }, { name: "error", value: counts.error, color: c.error }]}
          />
          <div className="mt-3"><Legend items={[{ name: `pass (${counts.pass})`, color: c.pass }, { name: `fail (${counts.fail})`, color: c.fail }, { name: `error (${counts.error})`, color: c.error }]} /></div>
        </ChartCard>
        <ChartCard className="lg:col-span-2" title={L("Findings by severity", "Ciddilik üzrə nəticələr")}>
          <Bars stacked height={190} xKey="name" data={bySeverity} series={[{ key: "pass", name: "pass", color: c.pass }, { key: "fail", name: "fail", color: c.fail }, { key: "error", name: "error", color: c.error }]} />
        </ChartCard>
      </div>

      {finished && s.status === "completed" && <AiAnalysisPanel scanId={id!} benchmarkId={s.benchmark_id} />}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {s.hosts.map((h) => (
          <div key={h.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <HostIcon os={h.os_detected?.toLowerCase().includes("windows") ? "windows" : "linux"} size={32} />
                <div className="min-w-0">
                  {h.asset_id ? <Link to={s.mode === "pam" ? "/pam/assets" : `/assets?host=${h.asset_id}`} className="block truncate font-semibold text-slate-50 hover:underline">{h.asset_name}</Link> : <div className="truncate font-semibold">{h.asset_name}</div>}
                  <div className="truncate font-mono text-xs text-slate-500">{h.host}</div>
                </div>
              </div>
              <StatusPill status={h.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-xs text-slate-500">{t("scan.compliance")}</div><div className="text-2xl font-semibold text-slate-50">{scoreText(h.score)}</div></div>
              <div><div className="text-xs text-slate-500">{t("scan.weighted")}</div><div className="text-2xl font-semibold text-slate-50">{scoreText(h.weighted_score)}</div></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <span className="text-emerald-300">{h.passed} {t("scan.pass")}</span>
              <span className="text-red-300">{h.failed} {t("scan.fail")}</span>
              <span className="text-amber-300">{h.errored} {t("scan.error")}</span>
              <span className="text-slate-500">{h.not_applicable} {t("scan.na")}</span>
            </div>
            {h.message && <p className="mt-2 text-xs text-amber-300">{h.message}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <section className="min-w-0 space-y-3">
          <h2 className="text-lg font-semibold">{t("scan.results")}</h2>
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(r) => r.id}
            storageKey="scan-results"
            exportName={`scan-${s.name}`}
            loading={results.isLoading}
            initialSort={{ id: "severity", dir: "desc" }}
            pageSizes={[25, 50, 100, 250]}
            emptyTitle={t("scan.noResults")}
            emptyHint={L("Change the status or severity filter.", "Vəziyyət və ya ciddilik süzgəcini dəyişin.")}
            toolbar={
              <>
                <Chips<StatusFilter> label="status" value={status} onChange={setStatus} options={[
                  { id: "fail", label: t("status.fail"), count: counts.fail },
                  { id: "error", label: t("scan.errorOpt"), count: counts.error },
                  { id: "pass", label: t("status.pass"), count: counts.pass },
                  { id: "not_applicable", label: t("scan.notApplicable"), count: counts.not_applicable },
                  { id: "all", label: L("All", "Hamısı"), count: counts.all },
                ]} />
                {s.hosts.length > 1 && (
                  <select className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm" value={hostFilter} onChange={(e) => setHostFilter(e.target.value === "" ? "" : Number(e.target.value))} aria-label="host filter">
                    <option value="">{t("scan.allHosts")}</option>
                    {s.hosts.map((h) => <option key={h.id} value={h.id}>{h.asset_name}</option>)}
                  </select>
                )}
                <select className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="severity filter">
                  <option value="">{L("All severities", "Bütün ciddiliklər")}</option>
                  {["critical", "high", "medium", "low"].map((sev) => <option key={sev} value={sev}>{sev}</option>)}
                </select>
                <input type="search" className={searchCls} placeholder={L("Search controls", "Nəzarət axtar")} value={q} onChange={(e) => setQ(e.target.value)} />
              </>
            }
            expanded={(r) => (
              <div className="space-y-3 text-xs">
                {explain(`scan.exp.${r.status}`) && <p className="text-slate-300">{explain(`scan.exp.${r.status}`)}</p>}
                {r.message && <p className="text-amber-200">{r.message}</p>}
                <ControlInfo benchmarkId={s.benchmark_id} controlId={r.control_id} />
                {r.status === "fail" && <CopilotPanel benchmarkId={s.benchmark_id} controlId={r.control_id} />}
                <div>
                  <div className="text-slate-400">{t("scan.rawOutput")} ({r.duration_ms} ms)</div>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-950 p-2 text-slate-300">{r.raw_output ?? t("scan.noOutput")}</pre>
                </div>
              </div>
            )}
          />
          <p className="text-xs text-slate-500">{t("scan.clickHint")}</p>
        </section>

        <aside className="space-y-3">
          <h2 className="text-lg font-semibold">{t("scan.liveFeed")}</h2>
          <ol className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900/60 p-3 text-xs">
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
