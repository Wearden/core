import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, PolarAngleAxis, RadialBar, RadialBarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { analyticsApi } from "../analyticsApi";
import { useI18n } from "../i18n";

const PIE_COLORS = ["#34d399", "#f87171", "#fbbf24", "#525252"];
const tooltipStyle = { background: "#171717", border: "1px solid #262626" };

function Gauge({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = value === null ? "#525252" : v >= 90 ? "#34d399" : v >= 70 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-40 w-40">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ name: label, value: v, fill: color }]} startAngle={90} endAngle={-270}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={8} background={{ fill: "#262626" }} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center text-2xl font-semibold">
          {value === null ? "-" : `${value.toFixed(1)}%`}
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
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e5e5e5" }} labelStyle={{ color: "#fafafa" }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <p className="text-sm text-slate-400">
                {t("ha.weighted")} {latest.weighted_score === null ? "-" : `${latest.weighted_score.toFixed(1)}%`}
              </p>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-2 font-semibold">{t("ha.failingSev")}</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.severities}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="severity" stroke="#737373" fontSize={12} />
                    <YAxis stroke="#737373" fontSize={12} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e5e5e5" }} labelStyle={{ color: "#fafafa" }} />
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis type="number" stroke="#737373" fontSize={12} allowDecimals={false} />
                  <YAxis type="category" dataKey="category" stroke="#737373" fontSize={11} width={200} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e5e5e5" }} labelStyle={{ color: "#fafafa" }} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis dataKey="when" stroke="#737373" fontSize={12} />
                    <YAxis domain={[0, 100]} stroke="#737373" fontSize={12} />
                    <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#e5e5e5" }} labelStyle={{ color: "#fafafa" }} />
                    <Legend />
                    <Line type="monotone" dataKey="score" name={t("dash.complianceBar")} stroke="#e5e5e5" strokeWidth={2} />
                    <Line type="monotone" dataKey="weighted_score" name={t("ha.weightedPct")} stroke="#a3a3a3" strokeWidth={2} />
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
