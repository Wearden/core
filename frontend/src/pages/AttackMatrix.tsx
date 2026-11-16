import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useI18n } from "../i18n";
import { Bars, ChartCard, useChartColors } from "../components/charts";
import { Chips, EmptyState, PageHeader, searchCls, tableWrap, theadCls } from "../components/ui";

interface Technique {
  id: string;
  name: string;
  controls: string[];
  before: number | null;
  after: number | null;
}

function Cell({ v }: { v: number | null }) {
  if (v === null) return <span className="text-slate-600">-</span>;
  const tone = v >= 90 ? "bg-emerald-400" : v >= 70 ? "bg-amber-400" : "bg-red-400";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-slate-200">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone}`} />
      {Math.round(v)}%
    </span>
  );
}

type View = "gaps" | "all" | "covered";
const PREVIEW = 15;

/** Techniques the benchmark mitigates, with coverage before and after hardening. */
export default function AttackMatrix() {
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const c = useChartColors();
  const q = useQuery({ queryKey: ["attack"], queryFn: () => api.attack("ubuntu-24.04-cis"), refetchInterval: 30_000 });
  const d = q.data;
  const [view, setView] = useState<View>("gaps");
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);

  const top = useMemo(() => (d ? [...d.techniques].filter((x) => x.after !== null).sort((a, b) => (a.after ?? 0) - (b.after ?? 0)).slice(0, 10) : []), [d]);
  const rows = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return (d?.techniques ?? [])
      .filter((x: Technique) => (view === "all" ? true : x.after === null ? false : view === "covered" ? x.after >= (d?.threshold ?? 90) : x.after < (d?.threshold ?? 90)))
      .filter((x: Technique) => !needle || `${x.id} ${x.name}`.toLowerCase().includes(needle))
      .sort((a: Technique, b: Technique) => (a.after ?? 101) - (b.after ?? 101));
  }, [d, view, text]);
  const shown = expanded ? rows : rows.slice(0, PREVIEW);

  return (
    <div className="space-y-6">
      <PageHeader title={t("atk.title")} subtitle={t("atk.subtitle")} />
      {q.error && <p className="text-red-400">{t("atk.loadError")}: {(q.error as Error).message}</p>}
      {d && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-500">{t("atk.mapped")}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-50">{d.total}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-500">{t("atk.coveredBefore").replace("{th}", String(d.threshold))}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-50">{d.mitigated_before}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <p className="text-xs uppercase tracking-wide text-slate-500">{t("atk.coveredNow").replace("{th}", String(d.threshold))}</p>
              <p className="mt-2 text-3xl font-semibold text-emerald-300">{d.mitigated_after}</p>
              <p className="mt-1 text-xs text-slate-500">{d.hosts_assessed} {t("atk.hostsAssessed")}</p>
            </div>
          </div>

          {top.length > 0 && (
            <ChartCard title={t("atk.weakest")} subtitle={L("The ten techniques with the lowest coverage now", "Hazırda ən aşağı əhatəli on texnika")}>
              <Bars
                horizontal
                yWidth={92}
                data={top.map((x) => ({ name: x.id, before: x.before ?? 0, after: x.after ?? 0 }))}
                xKey="name"
                height={Math.max(220, top.length * 34)}
                series={[{ key: "before", name: t("atk.beforePct"), color: c.soft }, { key: "after", name: t("atk.afterPct"), color: c.pass }]}
              />
            </ChartCard>
          )}

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Chips
                label="technique filter"
                value={view}
                onChange={(v) => { setView(v); setExpanded(false); }}
                options={[
                  { id: "gaps", label: L("Gaps", "Boşluqlar") },
                  { id: "covered", label: L("Covered", "Əhatə olunub") },
                  { id: "all", label: L("All", "Hamısı"), count: d.techniques.length },
                ]}
              />
              <input type="search" className={searchCls} placeholder={L("Search technique ID or name", "Texnika ID və ya adı ilə axtar")} value={text} onChange={(e) => setText(e.target.value)} />
            </div>
            {rows.length === 0 ? <EmptyState title={L("No techniques in this view", "Bu görünüşdə texnika yoxdur")} hint={L("Switch the filter or clear the search.", "Süzgəci dəyişin və ya axtarışı təmizləyin.")} /> : (
              <div className={tableWrap}>
                <table className="w-full text-left text-sm">
                  <thead className={theadCls}>
                    <tr>
                      <th className="px-4 py-2.5 font-medium">{t("atk.technique")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("atk.controls")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("atk.before")}</th>
                      <th className="px-4 py-2.5 font-medium">{t("atk.after")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {shown.map((tech: Technique) => (
                      <tr key={tech.id} className="hover:bg-slate-900/60">
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs text-slate-100">{tech.id}</span>
                          {tech.name && tech.name !== tech.id && <span className="ml-2 text-slate-400">{tech.name}</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">{tech.controls.length}</td>
                        <td className="px-4 py-2"><Cell v={tech.before} /></td>
                        <td className="px-4 py-2"><Cell v={tech.after} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > PREVIEW && (
                  <button onClick={() => setExpanded(!expanded)} className="w-full border-t border-slate-800 py-2.5 text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100">
                    {expanded ? L("Show fewer", "Daha az göstər") : L(`Show all ${rows.length}`, `Hamısını göstər (${rows.length})`)}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
