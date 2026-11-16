import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useI18n } from "../i18n";

interface Technique {
  id: string;
  name: string;
  controls: string[];
  before: number | null;
  after: number | null;
}

function cellColor(v: number | null): string {
  if (v === null) return "bg-slate-900 text-slate-600";
  if (v >= 90) return "bg-emerald-800/80 text-emerald-100";
  if (v >= 70) return "bg-amber-800/80 text-amber-100";
  return "bg-red-900/80 text-red-100";
}

/** Techniques the benchmark mitigates, with coverage before and after hardening. */
export default function AttackMatrix() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["attack"],
    queryFn: () => api.attack("ubuntu-24.04-cis"),
    refetchInterval: 30_000,
  });
  const d = q.data;
  const top = d ? [...d.techniques].filter((t) => t.after !== null).sort((a, b) => (a.after ?? 0) - (b.after ?? 0)).slice(0, 12) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("atk.title")}</h1>
        <p className="text-sm text-slate-400">{t("atk.subtitle")}</p>
      </div>

      {q.error && <p className="text-red-400">{t("atk.loadError")}: {(q.error as Error).message}</p>}
      {d && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-sm text-slate-400">{t("atk.mapped")}</p>
              <p className="mt-2 text-3xl font-semibold text-cyan-300">{d.total}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-sm text-slate-400">{t("atk.coveredBefore").replace("{th}", String(d.threshold))}</p>
              <p className="mt-2 text-3xl font-semibold text-amber-300">{d.mitigated_before}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <p className="text-sm text-slate-400">{t("atk.coveredNow").replace("{th}", String(d.threshold))}</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-300">{d.mitigated_after}</p>
              <p className="mt-1 text-xs text-slate-500">{d.hosts_assessed} {t("atk.hostsAssessed")}</p>
            </div>
          </div>

          {top.length > 0 && (
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-2 font-semibold">{t("atk.weakest")}</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top.map((t) => ({ name: `${t.id} ${t.name}`.slice(0, 40), before: t.before ?? 0, after: t.after ?? 0 }))} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                    <XAxis type="number" domain={[0, 100]} stroke="#737373" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="#737373" fontSize={11} width={260} />
                    <Tooltip contentStyle={{ background: "#171717", border: "1px solid #262626" }} itemStyle={{ color: "#e5e5e5" }} labelStyle={{ color: "#fafafa" }} />
                    <Legend />
                    <Bar dataKey="before" name={t("atk.beforePct")} fill="#f87171" />
                    <Bar dataKey="after" name={t("atk.afterPct")} fill="#34d399" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="px-4 py-3">{t("atk.technique")}</th>
                  <th className="px-4 py-3">{t("col.name")}</th>
                  <th className="px-4 py-3">{t("atk.controls")}</th>
                  <th className="px-4 py-3 text-center">{t("atk.before")}</th>
                  <th className="px-4 py-3 text-center">{t("atk.after")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {d.techniques.map((tech: Technique) => (
                  <tr key={tech.id} className="hover:bg-slate-900/60">
                    <td className="px-4 py-2 font-mono text-xs">{tech.id}</td>
                    <td className="px-4 py-2">{tech.name || <span className="text-slate-500">{t("atk.noName")}</span>}</td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-400">{tech.controls.length}</td>
                    <td className="px-4 py-2 text-center"><span className={`inline-block w-20 rounded px-2 py-1 text-xs ${cellColor(tech.before)}`}>{tech.before === null ? "-" : `${tech.before}%`}</span></td>
                    <td className="px-4 py-2 text-center"><span className={`inline-block w-20 rounded px-2 py-1 text-xs ${cellColor(tech.after)}`}>{tech.after === null ? "-" : `${tech.after}%`}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
