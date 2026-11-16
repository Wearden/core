import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { benchmarksApi } from "../benchmarksApi";
import { scansApi } from "../scansApi";
import { analyticsApi, download } from "../analyticsApi";
import { hardeningApi } from "../hardeningApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { Chips, EmptyState, PageHeader } from "../components/ui";

const field = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

function heatColor(v: number | null): string {
  if (v === null) return "bg-slate-900 text-slate-600";
  if (v >= 90) return "bg-emerald-800/80 text-emerald-100";
  if (v >= 70) return "bg-amber-800/80 text-amber-100";
  return "bg-red-900/80 text-red-100";
}

export default function Reports() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const benches = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list });
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list });
  const runs = useQuery({ queryKey: ["runs"], queryFn: hardeningApi.runs });
  const [bid, setBid] = useState("");
  const [tab, setTab] = useState<"export" | "heat" | "changes">("export");
  // Default to a benchmark that actually has scan data instead of the first one alphabetically.
  const withData = (scans.data ?? []).find((s) => s.status === "completed")?.benchmark_id;
  const benchmarkId = bid || withData || benches.data?.[0]?.id || "";
  const heat = useQuery({ queryKey: ["heatmap", benchmarkId], queryFn: () => analyticsApi.heatmap(benchmarkId), enabled: !!benchmarkId });

  const [scanId, setScanId] = useState("");
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const diff = useQuery({
    queryKey: ["diff", runId, status, q],
    queryFn: () => analyticsApi.diff({ runId: runId || undefined, status: status || undefined, q: q || undefined }),
  });
  const completedScans = useMemo(() => (scans.data ?? []).filter((s) => s.status === "completed"), [scans.data]);
  const activeScan = scanId || completedScans[0]?.id || "";
  const [message, setMessage] = useState<string | null>(null);

  const exportFile = async (path: string, name: string) => {
    setMessage(null);
    try {
      await download(path, name);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("rep.exportFail"));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t("rep.title")} subtitle={t("rep.subtitle")} />
      <Chips
        label="report section"
        value={tab}
        onChange={setTab}
        options={[
          { id: "export", label: lang === "az" ? "Yoxlama hesabatları" : "Scan reports" },
          { id: "heat", label: lang === "az" ? "Uyğunluq xəritəsi" : "Compliance heatmap" },
          { id: "changes", label: lang === "az" ? "Əvvəl və sonra" : "Before and after" },
        ]}
      />

      {tab === "heat" && <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("rep.heatTitle")}</h2>
          <label className="text-sm">
            <span className="text-slate-500">{t("hard.benchmark")} </span>
            <select className={field} value={benchmarkId} onChange={(e) => setBid(e.target.value)}>
              {(benches.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>
        {heat.data && heat.data.rows.length === 0 && <EmptyState title={t("rep.noHeat")} hint={lang === "az" ? "Başqa benchmark seçin və ya əvvəlcə yoxlama işlədin." : "Pick another benchmark or run a scan first."} />}
        {heat.data && heat.data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-slate-900 px-2 py-1 text-left">{t("col.host")}</th>
                  {heat.data.categories.map((c) => (
                    <th key={c} className="max-w-[7rem] px-1 py-1 text-left font-normal text-slate-400">
                      <div className="w-28 truncate" title={c}>{c}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.data.rows.map((row) => (
                  <tr key={row.asset_id}>
                    <td className="sticky left-0 bg-slate-900 px-2 py-1">
                      <Link to={`/hosts/${row.asset_id}`} className="text-cyan-300 hover:underline">{row.asset_name}</Link>
                    </td>
                    {heat.data!.categories.map((c) => {
                      const v = row.cells[c] ?? null;
                      return (
                        <td key={c} className="p-0.5">
                          <div className={`flex h-8 w-28 items-center justify-center rounded ${heatColor(v)}`} title={`${c}: ${v === null ? t("rep.noData") : `${v}%`}`}>
                            {v === null ? "-" : `${Math.round(v)}%`}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}

      {tab === "changes" && <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-semibold">{t("rep.beforeAfter")}</h2>
          <select className={field} value={runId} onChange={(e) => setRunId(e.target.value)} aria-label="run">
            <option value="">{t("rep.latestRun")}</option>
            {(runs.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="change status">
            <option value="">{t("scan.allStatuses")}</option>
            <option value="applied">{t("rep.applied")}</option>
            <option value="skipped">{t("rep.skipped")}</option>
            <option value="failed">{t("rep.failed")}</option>
            <option value="reverted">{t("rep.reverted")}</option>
            <option value="auto_rolled_back">{t("rep.autoRb")}</option>
          </select>
          <input className={`${field} flex-1`} placeholder={t("rep.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {diff.data?.rows.length === 0 && <p className="text-sm text-slate-400">{t("rep.noMatch")}</p>}
        {diff.data && diff.data.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-400">
                <tr>
                  <th className="px-3 py-2">{t("col.host")}</th>
                  <th className="px-3 py-2">{t("col.control")}</th>
                  <th className="px-3 py-2">{t("rep.expected")}</th>
                  <th className="px-3 py-2">{t("rep.before")}</th>
                  <th className="px-3 py-2">{t("rep.after")}</th>
                  <th className="px-3 py-2">{t("col.status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {diff.data.rows.map((r) => (
                  <tr key={r.change_id} className="align-top">
                    <td className="px-3 py-2 text-xs">{r.asset_name}</td>
                    <td className="px-3 py-2">
                      <div>{r.title}</div>
                      <div className="font-mono text-xs text-slate-500">{r.control_id} · {r.severity}</div>
                    </td>
                    <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-xs text-slate-400" title={r.expected}>{r.expected}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-xs text-slate-300" title={r.before ?? ""}>{r.before ?? "-"}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-xs text-slate-100" title={r.after ?? ""}>{r.after ?? "-"}</td>
                    <td className="px-3 py-2 text-xs">{r.status.replace(/_/g, " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {runId && (
          <button onClick={() => exportFile(`/reports/hardening/${runId}.csv`, `hardening-${runId}.csv`)} className="text-sm text-cyan-300 hover:underline">
            {t("rep.exportCsv")}
          </button>
        )}
      </section>}

      {tab === "export" && <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="font-semibold">{t("rep.scanReport")}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <select className={field} value={activeScan} onChange={(e) => setScanId(e.target.value)} aria-label="scan">
            {completedScans.length === 0 && <option value="">{t("rep.noCompleted")}</option>}
            {completedScans.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button disabled={!activeScan} onClick={() => exportFile(`/reports/scans/${activeScan}.pdf`, `scan-${activeScan}.pdf`)} className="rounded-md bg-cyan-600 px-3 py-2 text-sm text-white hover:bg-cyan-500 disabled:opacity-40">PDF</button>
          <button disabled={!activeScan} onClick={() => exportFile(`/reports/scans/${activeScan}.csv`, `scan-${activeScan}.csv`)} className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40">CSV</button>
          <button disabled={!activeScan} onClick={() => exportFile(`/reports/scans/${activeScan}.json`, `scan-${activeScan}.json`)} className="rounded-md border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 disabled:opacity-40">JSON</button>
          {!canOperate && <span className="text-xs text-slate-500">{t("rep.viewerNote")}</span>}
        </div>
        <p className="text-xs text-slate-500">{t("rep.pdfNote")}</p>
        {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
      </section>}
    </div>
  );
}
