import { useMemo, useState } from "react";
import { Chips } from "../components/ui";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, request } from "../api";
import { agentsApi } from "../agentsApi";
import { analyticsApi } from "../analyticsApi";
import { hardeningApi } from "../hardeningApi";
import { scansApi } from "../scansApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Bars, ChartCard, HeatGrid, Legend, RadarScores, Ring, Spark, TrendArea, useChartColors } from "../components/charts";
import { dateTime } from "../time";

interface DriftRow {
  id: number;
  severity: string;
  message: string;
  detected_at: string;
}

function Kpi({ label, value, hint, spark, tone }: { label: string; value: string | number; hint?: string; spark?: number[]; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 md:p-5">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl md:text-3xl font-semibold tracking-tight ${tone ?? "text-slate-50"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {spark && <div className="mt-2"><Spark values={spark} /></div>}
    </div>
  );
}

const SEVERITIES = ["critical", "high", "medium", "low"];
const short = (iso: string) => dateTime(iso, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const c = useChartColors();
  const canOperate = user?.level === "admin" || user?.level === "operator";

  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const db = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 10_000 });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: analyticsApi.dashboard, refetchInterval: 10_000 });
  const drift = useQuery({ queryKey: ["drift"], queryFn: () => request<DriftRow[]>("/drift?active_only=true"), refetchInterval: 30_000 });
  const runDrift = useMutation({
    mutationFn: () => request<{ queued: boolean }>("/drift/run", { method: "POST" }),
    onSuccess: () => window.setTimeout(() => drift.refetch(), 5000),
  });

  // Newest completed scans drive every trend; the newest one drives the per-control charts.
  const [range, setRangeState] = useState<"5" | "8" | "12" | "24">(() => {
    try { const v = localStorage.getItem("wearden.dash.range"); return v === "5" || v === "12" || v === "24" ? v : "8"; } catch { return "8"; }
  });
  const setRange = (v: "5" | "8" | "12" | "24") => { setRangeState(v); try { localStorage.setItem("wearden.dash.range", v); } catch { /* convenience only */ } };
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list, refetchInterval: 30_000 });
  const completed = useMemo(
    () => (scans.data ?? []).filter((s) => s.status === "completed").sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Number(range)),
    [scans.data, range],
  );
  const latest = completed[0];
  const details = useQuery({
    queryKey: ["dash-scan-details", completed.map((s) => s.id).join(",")],
    queryFn: () => Promise.all(completed.map((s) => scansApi.get(s.id))),
    enabled: completed.length > 0,
  });
  const results = useQuery({ queryKey: ["dash-results", latest?.id], queryFn: () => scansApi.results(latest!.id), enabled: !!latest });
  const heat = useQuery({ queryKey: ["dash-heat", latest?.benchmark_id], queryFn: () => analyticsApi.heatmap(latest!.benchmark_id), enabled: !!latest });
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list, refetchInterval: 30_000 });
  const runs = useQuery({ queryKey: ["dash-runs"], queryFn: hardeningApi.runs, refetchInterval: 30_000 });

  const d = dash.data;

  const trend = useMemo(() => {
    const rows = [...(details.data ?? [])].reverse().map((s) => {
      const scored = s.hosts.filter((h) => h.score !== null);
      const avg = scored.length ? scored.reduce((a, h) => a + (h.score ?? 0), 0) / scored.length : 0;
      const pass = s.hosts.reduce((a, h) => a + h.passed, 0);
      const fail = s.hosts.reduce((a, h) => a + h.failed, 0);
      const err = s.hosts.reduce((a, h) => a + h.errored, 0);
      return { name: short(s.created_at), score: Math.round(avg * 10) / 10, pass, fail, error: err };
    });
    return rows;
  }, [details.data]);

  const latestTotals = trend[trend.length - 1];

  const bySeverity = useMemo(
    () =>
      SEVERITIES.map((sev) => {
        const rows = (results.data ?? []).filter((r) => r.severity === sev);
        return { name: sev, pass: rows.filter((r) => r.status === "pass").length, fail: rows.filter((r) => r.status === "fail").length, error: rows.filter((r) => r.status === "error").length };
      }),
    [results.data],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, { pass: number; fail: number }>();
    for (const r of results.data ?? []) {
      if (r.status !== "pass" && r.status !== "fail") continue;
      const e = map.get(r.category) ?? { pass: 0, fail: 0 };
      e[r.status] += 1;
      map.set(r.category, e);
    }
    return [...map.entries()].map(([name, e]) => ({ name, score: Math.round((e.pass / (e.pass + e.fail)) * 100), fail: e.fail })).sort((a, b) => a.score - b.score);
  }, [results.data]);

  const topFailing = useMemo(() => {
    const map = new Map<string, { id: string; title: string; severity: string; hosts: number }>();
    for (const r of results.data ?? []) {
      if (r.status !== "fail") continue;
      const e = map.get(r.control_id) ?? { id: r.control_id, title: r.title, severity: r.severity, hosts: 0 };
      e.hosts += 1;
      map.set(r.control_id, e);
    }
    return [...map.values()].sort((a, b) => b.hosts - a.hosts).slice(0, 8);
  }, [results.data]);

  const fleet = useMemo(() => {
    const list = agents.data ?? [];
    return { linux: list.filter((a) => a.os === "linux").length, windows: list.filter((a) => a.os === "windows").length, online: list.filter((a) => a.status === "online").length, total: list.length };
  }, [agents.data]);

  const hardening = useMemo(
    () => [...(runs.data ?? [])].slice(0, Number(range)).reverse().map((r) => ({ name: short(r.created_at), applied: r.applied_count, other: Math.max(0, r.total_changes - r.applied_count) })),
    [runs.data, range],
  );

  const hostStatus = d
    ? [
        { name: t("status.online"), value: d.hosts_online, color: c.pass },
        { name: t("status.degraded"), value: d.hosts_degraded, color: c.error },
        { name: t("status.offline"), value: d.hosts_offline, color: c.fail },
        { name: t("dash.unknown"), value: d.hosts_unknown, color: c.soft },
      ]
    : [];

  const heatRows = (heat.data?.rows ?? []).map((r) => ({ name: r.asset_name, cells: r.cells }));
  const empty = <p className="py-10 text-center text-sm text-slate-500">{t("dash.noScans")}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("nav.dashboard")}</h1>
          <p className="text-sm text-slate-500">
            {t("dash.welcome")}, {user?.username}. API {health.data?.status === "ok" ? t("dash.apiOnline") : t("dash.apiDown")} · {t("dash.database")} {db.data?.database === "ok" ? t("dash.dbOk") : t("dash.dbDown")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {L("Trend window", "Trend aralığı")}
          <Chips label="trend window" value={range} onChange={setRange} options={[{ id: "5", label: L("Last 5", "Son 5") }, { id: "8", label: L("Last 8", "Son 8") }, { id: "12", label: L("Last 12", "Son 12") }, { id: "24", label: L("Last 24", "Son 24") }]} />
        </div>
      </div>

      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
            <Kpi label={t("dash.hosts")} value={d.hosts_total} hint={`${d.hosts_scanned} ${t("dash.scanned")}`} />
            <Kpi label={t("dash.onlineOffline")} value={`${d.hosts_online} / ${d.hosts_offline}`} tone={d.hosts_offline ? "text-red-300" : "text-emerald-300"} hint={`${d.hosts_degraded} ${t("dash.degraded")}`} />
            <Kpi label={t("dash.average")} value={d.average_score === null ? "-" : `${d.average_score.toFixed(1)}%`} spark={trend.map((p) => p.score)} />
            <Kpi label={t("dash.critical")} value={d.critical_failed} tone={d.critical_failed ? "text-red-300" : "text-emerald-300"} hint={`${d.changes_applied} ${t("dash.changesApplied")}`} spark={trend.map((p) => p.fail)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard className="xl:col-span-2" title={L("Compliance trend", "Uyğunluq trendi")} subtitle={L("Average score of the latest completed scans", "Son tamamlanmış yoxlamaların orta nəticəsi")}>
              {trend.length === 0 ? empty : <TrendArea data={trend} xKey="name" domain={[0, 100]} series={[{ key: "score", name: t("dash.complianceBar"), color: c.line }]} />}
            </ChartCard>
            <ChartCard title={L("Latest scan results", "Son yoxlamanın nəticəsi")} subtitle={latest?.name}>
              {!latestTotals ? empty : (
                <>
                  <Ring
                    centerValue={`${Math.round((latestTotals.pass / Math.max(1, latestTotals.pass + latestTotals.fail + latestTotals.error)) * 100)}%`}
                    centerLabel={L("passing", "keçir")}
                    data={[
                      { name: "pass", value: latestTotals.pass, color: c.pass },
                      { name: "fail", value: latestTotals.fail, color: c.fail },
                      { name: "error", value: latestTotals.error, color: c.error },
                    ]}
                  />
                  <div className="mt-3"><Legend items={[{ name: "pass", color: c.pass }, { name: "fail", color: c.fail }, { name: "error", color: c.error }]} /></div>
                </>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard title={L("Findings by severity", "Ciddilik üzrə nəticələr")} right={<Legend items={[{ name: "pass", color: c.pass }, { name: "fail", color: c.fail }, { name: "error", color: c.error }]} />}>
              {bySeverity.every((s) => s.pass + s.fail + s.error === 0) ? empty : (
                <Bars data={bySeverity} xKey="name" stacked series={[{ key: "pass", name: "pass", color: c.pass }, { key: "fail", name: "fail", color: c.fail }, { key: "error", name: "error", color: c.error }]} />
              )}
            </ChartCard>
            <ChartCard title={L("Category profile", "Kateqoriya profili")} subtitle={L("Share of passing controls", "Keçən nəzarətlərin payı")}>
              {byCategory.length < 3 ? empty : <RadarScores name={t("dash.complianceBar")} data={byCategory.slice(0, 8).map((x) => ({ axis: x.name.length > 13 ? `${x.name.slice(0, 12)}.` : x.name, value: x.score }))} />}
            </ChartCard>
            <ChartCard title={t("dash.hostStatus")} subtitle={`${d.scans_active} ${t("dash.running")} · ${d.scans_total} ${t("dash.total")}`}>
              {hostStatus.every((s) => s.value === 0) ? <p className="py-10 text-center text-sm text-slate-500">{t("dash.noHosts")}</p> : (
                <>
                  <Ring data={hostStatus} centerValue={String(d.hosts_total)} centerLabel={t("dash.hosts")} />
                  <div className="mt-3"><Legend items={hostStatus.filter((s) => s.value > 0).map((s) => ({ name: `${s.name} (${s.value})`, color: s.color }))} /></div>
                </>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard className="xl:col-span-2" title={t("dash.byHost")}>
              {d.scores_by_host.length === 0 ? empty : (
                <Bars horizontal data={d.scores_by_host.map((h) => ({ name: h.asset_name, score: h.score ?? 0 }))} xKey="name" height={Math.max(160, d.scores_by_host.length * 44)} series={[{ key: "score", name: t("dash.complianceBar"), color: c.line }]} />
              )}
            </ChartCard>
            <ChartCard title={L("Most failing controls", "Ən çox uğursuz nəzarətlər")} subtitle={L("Hosts affected in the latest scan", "Son yoxlamada təsirlənən hostlar")}>
              {topFailing.length === 0 ? empty : (
                <ul className="space-y-3">
                  {topFailing.map((f) => (
                    <li key={f.id}>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate text-slate-200" title={f.title}>{f.title}</span>
                        <span className="shrink-0 text-slate-500">{f.hosts}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full rounded-full" style={{ width: `${(f.hosts / Math.max(1, topFailing[0].hosts)) * 100}%`, background: f.severity === "critical" || f.severity === "high" ? c.fail : c.error }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>

          <ChartCard title={L("Compliance heatmap", "Uyğunluq istilik xəritəsi")} subtitle={L("Hosts by control category, score in percent", "Hostlar və kateqoriyalar üzrə nəticə, faizlə")}>
            {heatRows.length === 0 ? empty : <HeatGrid categories={heat.data?.categories ?? []} rows={heatRows} />}
          </ChartCard>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard className="xl:col-span-2" title={L("Hardening runs", "Möhkəmləndirmə işləri")} subtitle={L("Applied changes per recent run", "Son işlərdə tətbiq olunan dəyişikliklər")}>
              {hardening.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">{L("No hardening runs yet.", "Hələ möhkəmləndirmə işi yoxdur.")}</p> : (
                <Bars data={hardening} xKey="name" stacked series={[{ key: "applied", name: L("applied", "tətbiq"), color: c.pass }, { key: "other", name: L("not applied", "tətbiq olunmayıb"), color: c.soft }]} />
              )}
            </ChartCard>
            <ChartCard title={L("Agent fleet", "Agent parkı")} subtitle={`${fleet.online} / ${fleet.total} ${L("online", "onlayn")}`}>
              {fleet.total === 0 ? <p className="py-10 text-center text-sm text-slate-500">{L("No agents enrolled.", "Agent qeydiyyatdan keçməyib.")}</p> : (
                <>
                  <Ring centerValue={String(fleet.total)} centerLabel={L("agents", "agent")} data={[{ name: "Linux", value: fleet.linux, color: c.line }, { name: "Windows", value: fleet.windows, color: c.soft }]} />
                  <div className="mt-3"><Legend items={[{ name: `Linux (${fleet.linux})`, color: c.line }, { name: `Windows (${fleet.windows})`, color: c.soft }]} /></div>
                </>
              )}
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">{t("dash.drift")}</h2>
                {canOperate && (
                  <button onClick={() => runDrift.mutate()} disabled={runDrift.isPending} className="rounded-md border border-slate-700 px-3 py-1 text-xs hover:bg-slate-800 disabled:opacity-40">
                    {t("dash.checkDrift")}
                  </button>
                )}
              </div>
              {(drift.data ?? []).length === 0 && <p className="text-sm text-slate-500">{t("dash.noDrift")}</p>}
              <ul className="space-y-2 text-sm">
                {(drift.data ?? []).map((ev) => (
                  <li key={ev.id} className="rounded-md border border-slate-800 px-3 py-2">
                    <div className="text-slate-200">{ev.message}</div>
                    <div className="text-xs text-slate-500">{dateTime(ev.detected_at)} · {ev.severity}</div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium">{t("dash.recent")}</h2>
                <Link to="/audit" className="text-xs text-slate-400 hover:text-slate-100 hover:underline">{t("dash.fullAudit")}</Link>
              </div>
              {d.recent_activity.length === 0 && <p className="text-sm text-slate-500">{t("dash.nothing")}</p>}
              <ul className="divide-y divide-slate-800 text-sm">
                {d.recent_activity.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-40 text-xs text-slate-500">{dateTime(a.at)}</span>
                    <span className="font-mono text-xs text-slate-300">{a.action}</span>
                    <span className="text-slate-400">{a.target ?? ""}</span>
                    {!a.success && <span className="text-red-300">{t("dash.failed")}</span>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      {dash.error && <p className="text-red-400">{t("dash.loadError")}: {(dash.error as Error).message}</p>}
    </div>
  );
}
