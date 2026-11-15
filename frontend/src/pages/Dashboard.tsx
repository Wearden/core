import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, request } from "../api";

interface DriftRow {
  id: number;
  severity: string;
  message: string;
  detected_at: string;
}
import { analyticsApi } from "../analyticsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

function Kpi({ label, value, tone = "text-cyan-300", hint }: { label: string; value: string | number; tone?: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${tone}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return "#475569";
  if (score >= 90) return "#34d399";
  if (score >= 70) return "#fbbf24";
  return "#f87171";
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const db = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 10_000 });
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: analyticsApi.dashboard, refetchInterval: 10_000 });
  const d = dash.data;
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const drift = useQuery({ queryKey: ["drift"], queryFn: () => request<DriftRow[]>("/drift?active_only=true"), refetchInterval: 30_000 });
  const runDrift = useMutation({
    mutationFn: () => request<{ queued: boolean }>("/drift/run", { method: "POST" }),
    onSuccess: () => window.setTimeout(() => drift.refetch(), 5000),
  });

  const statusData = d
    ? [
        { name: t("status.online"), value: d.hosts_online, fill: "#34d399" },
        { name: t("status.degraded"), value: d.hosts_degraded, fill: "#fbbf24" },
        { name: t("status.offline"), value: d.hosts_offline, fill: "#f87171" },
        { name: t("dash.unknown"), value: d.hosts_unknown, fill: "#64748b" },
      ].filter((s) => s.value > 0)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("nav.dashboard")}</h1>
          <p className="text-sm text-slate-400">
            {t("dash.welcome")}, {user?.username}. API {health.data?.status === "ok" ? t("dash.apiOnline") : t("dash.apiDown")} · {t("dash.database")}{" "}
            {db.data?.database === "ok" ? t("dash.dbOk") : t("dash.dbDown")}
          </p>
        </div>
      </div>

      {d && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Kpi label={t("dash.hosts")} value={d.hosts_total} hint={`${d.hosts_scanned} ${t("dash.scanned")}`} />
            <Kpi label={t("dash.onlineOffline")} value={`${d.hosts_online} / ${d.hosts_offline}`} tone={d.hosts_offline ? "text-red-300" : "text-emerald-300"} hint={`${d.hosts_degraded} ${t("dash.degraded")}`} />
            <Kpi label={t("dash.average")} value={d.average_score === null ? "-" : `${d.average_score.toFixed(1)}%`} tone="text-cyan-300" />
            <Kpi label={t("dash.critical")} value={d.critical_failed} tone={d.critical_failed ? "text-red-300" : "text-emerald-300"} hint={`${d.changes_applied} ${t("dash.changesApplied")}`} />
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 xl:col-span-2">
              <h2 className="mb-3 font-semibold">{t("dash.byHost")}</h2>
              {d.scores_by_host.length === 0 && <p className="text-sm text-slate-400">{t("dash.noScans")}</p>}
              {d.scores_by_host.length > 0 && (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.scores_by_host.map((h) => ({ name: h.asset_name, score: h.score ?? 0, raw: h.score }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                      <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={12} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#f8fafc" }} />
                      <Bar dataKey="score" name={t("dash.complianceBar")}>
                        {d.scores_by_host.map((h) => <Cell key={h.asset_id} fill={scoreColor(h.score)} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-3 font-semibold">{t("dash.hostStatus")}</h2>
              {statusData.length === 0 ? (
                <p className="text-sm text-slate-400">{t("dash.noHosts")}</p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                        {statusData.map((s) => <Cell key={s.name} fill={s.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#f8fafc" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              <p className="text-xs text-slate-500">{d.scans_active} {t("dash.running")} · {d.scans_total} {t("dash.total")}</p>
            </section>
          </div>

          <section className="rounded-xl border border-red-900/60 bg-slate-900 p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">{t("dash.drift")}</h2>
              {canOperate && (
                <button onClick={() => runDrift.mutate()} disabled={runDrift.isPending} className="rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-40">
                  {t("dash.checkDrift")}
                </button>
              )}
            </div>
            {(drift.data ?? []).length === 0 && <p className="text-sm text-slate-400">{t("dash.noDrift")}</p>}
            <ul className="space-y-2 text-sm">
              {(drift.data ?? []).map((ev) => (
                <li key={ev.id} className="rounded bg-red-950/40 px-3 py-2 text-red-100">
                  <div>{ev.message}</div>
                  <div className="text-xs text-red-300/70">{new Date(ev.detected_at).toLocaleString()} · {ev.severity}</div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{t("dash.recent")}</h2>
              <Link to="/audit" className="text-sm text-cyan-300 hover:underline">{t("dash.fullAudit")}</Link>
            </div>
            {d.recent_activity.length === 0 && <p className="text-sm text-slate-400">{t("dash.nothing")}</p>}
            <ul className="divide-y divide-slate-800 text-sm">
              {d.recent_activity.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-44 text-xs text-slate-500">{new Date(a.at).toLocaleString()}</span>
                  <span className="font-mono text-xs text-slate-300">{a.action}</span>
                  <span className="text-slate-400">{a.target ?? ""}</span>
                  <span className="text-slate-500">{a.user ?? ""}</span>
                  {!a.success && <span className="text-red-300">{t("dash.failed")}</span>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      {dash.error && <p className="text-red-400">{t("dash.loadError")}: {(dash.error as Error).message}</p>}
    </div>
  );
}
