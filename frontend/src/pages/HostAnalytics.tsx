import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { analyticsApi } from "../analyticsApi";
import { useI18n } from "../i18n";

const PIE_COLORS = ["#34d399", "#f87171", "#fbbf24", "#64748b"];
const tooltipStyle = { background: "#0f172a", border: "1px solid #1e293b" };

function Gauge({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = value === null ? "#475569" : v >= 90 ? "#34d399" : v >= 70 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-40 w-40">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: label, value: v, fill: color }]} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "#1e293b" }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold">
          {value === null ? "—" : `${value.toFixed(1)}%`}
        </div>
      </div>
      <div className="mt-2 text-sm text-slate-400">{label}</div>
    </div>
  );
}

export default function HostAnalytics() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const assetId = Number(id);
  const q = useQuery({ queryKey: ["host-analytics", assetId], queryFn: () => analyticsApi.host(assetId), enabled: Number.isFinite(assetId), refetchInterval: 15_000 });
  const d = q.data;

  if (q.error) return <p className="text-red-400">{t("ha.notFound")}</p>;
  if (!d) return <p className="text-slate-400">{t("common.loading")}</p>;

  const latest = d.latest;
  const ba = d.before_after;
  const hasTrend = d.trend.length > 1;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/assets" className="text-sm text-slate-400 hover:text-slate-200">{t("ha.back")}</Link>
        <h1 className="mt-1 text-2xl font-bold">{d.asset.name}</h1>
        <p className="text-sm text-slate-400">
          <span className="font-mono">{d.asset.host}</span> · {d.asset.os_detected ?? t("ha.osNotRecorded")} · {t("ha.status")} {d.asset.status}
        </p>
      </div>

      {!latest && (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
          {t("ha.noScan")}
        </div>
      )}

      {latest && (
        <>
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-2 font-semibold">{t("ha.beforeAfter")}</h2>
              <div className="flex justify-around">
                <Gauge label={t("ha.before")} value={ba.before?.score ?? null} />
                <Gauge label={t("ha.after")} value={ba.after?.score ?? null} />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {t("ha.beforeNote")}
                {d.hardening.run_name ? `. ${t("ha.latestRun")} ${d.hardening.run_name}.` : "."}
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-2 font-semibold">{t("ha.passFailErr")}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={d.donut} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {d.donut.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#f8fafc" }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-sm text-slate-400">
                {t("ha.weighted")} {latest.weighted_score === null ? "—" : `${latest.weighted_score.toFixed(1)}%`}
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-2 font-semibold">{t("ha.failingSev")}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.severities}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="severity" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#f8fafc" }} />
                    <Legend />
                    <Bar dataKey="pass" name={t("ha.pass")} fill="#34d399" />
                    <Bar dataKey="fail" name={t("ha.fail")} fill="#f87171" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-2 font-semibold">{t("ha.byCat")}</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.categories} layout="vertical" margin={{ left: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis type="number" stroke="#94a3b8" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="category" stroke="#94a3b8" fontSize={11} width={200} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#f8fafc" }} />
                  <Legend />
                  <Bar dataKey="pass" name={t("ha.pass")} stackId="a" fill="#34d399" />
                  <Bar dataKey="fail" name={t("ha.fail")} stackId="a" fill="#f87171" />
                  <Bar dataKey="error" name={t("ha.error")} stackId="a" fill="#fbbf24" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="mb-2 font-semibold">{t("ha.trend")}</h2>
            {!hasTrend && <p className="text-sm text-slate-400">{t("ha.needTwo")}</p>}
            {hasTrend && (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={d.trend.map((p) => ({ ...p, when: new Date(p.at).toLocaleDateString() }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="when" stroke="#94a3b8" fontSize={12} />
                    <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={12} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e2e8f0" }} labelStyle={{ color: "#f8fafc" }} />
                    <Legend />
                    <Line type="monotone" dataKey="score" name={t("dash.complianceBar")} stroke="#22d3ee" strokeWidth={2} />
                    <Line type="monotone" dataKey="weighted_score" name={t("ha.weightedPct")} stroke="#a78bfa" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
