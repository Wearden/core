import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { agentsApi } from "../agentsApi";
import { analyticsApi } from "../analyticsApi";
import { assetsApi } from "../assetsApi";
import { benchmarksApi } from "../benchmarksApi";
import { hardeningApi } from "../hardeningApi";
import { scansApi } from "../scansApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import AgentLogs from "./AgentLogs";
import HostIcon, { osLabel } from "./HostIcon";
import StatusPill from "./StatusPill";
import { Bars, Ring, TrendArea, useChartColors } from "./charts";
import { Chips, EmptyState, ShortId, searchCls, tableWrap, theadCls } from "./ui";

export type DrawerTab = "overview" | "findings" | "hardening" | "logs";

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? "text-slate-50"}`}>{value}</div>
    </div>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/70 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-right text-slate-200">{children}</dd>
    </div>
  );
}

/** Large side panel with everything about one workstation: health, findings, hardening history and agent logs. */
export default function AssetDrawer({ assetId, tab, onTab, onClose }: { assetId: number; tab: DrawerTab; onTab: (t: DrawerTab) => void; onClose: () => void }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const L = (en: string, a: string) => (az ? a : en);
  const navigate = useNavigate();
  const c = useChartColors();
  const canOperate = user?.level === "admin" || user?.level === "operator";

  // Closing plays a short exit animation first; the timeout also covers reduced-motion, where animations are off.
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = prev;
    };
  }, [close]);

  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const asset = assets.data?.find((a) => a.id === assetId);
  const agents = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  const agent = agents.data?.find((a) => a.asset_id === assetId && a.status !== "revoked") ?? agents.data?.find((a) => a.asset_id === assetId);
  const host = useQuery({ queryKey: ["host-analytics", assetId], queryFn: () => analyticsApi.host(assetId), refetchInterval: 30_000 });
  const latest = host.data?.latest ?? null;

  const scanDetail = useQuery({ queryKey: ["drawer-scan", latest?.scan_id], queryFn: () => scansApi.get(latest!.scan_id), enabled: !!latest && tab === "findings" });
  const hostResult = scanDetail.data?.hosts.find((h) => h.asset_id === assetId);
  const results = useQuery({ queryKey: ["drawer-results", latest?.scan_id, hostResult?.id], queryFn: () => scansApi.results(latest!.scan_id, hostResult!.id), enabled: !!hostResult });
  const [status, setStatus] = useState<"fail" | "all" | "pass" | "error">("fail");
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (results.data ?? []).filter((r) => (status === "all" || r.status === status) && (!needle || `${r.title} ${r.control_id}`.toLowerCase().includes(needle)));
  }, [results.data, status, q]);
  const counts = useMemo(() => {
    const rows = results.data ?? [];
    return { fail: rows.filter((r) => r.status === "fail").length, error: rows.filter((r) => r.status === "error").length, pass: rows.filter((r) => r.status === "pass").length, all: rows.length };
  }, [results.data]);

  const runs = useQuery({ queryKey: ["drawer-runs", assetId], enabled: tab === "hardening", queryFn: async () => {
    const list = (await hardeningApi.runs()).slice(0, 8);
    const details = await Promise.all(list.map((r) => hardeningApi.run(r.id)));
    return details.map((d) => ({ run: d, mine: d.changes.filter((ch) => ch.asset_id === assetId) })).filter((x) => x.mine.length > 0);
  } });

  const original = agent?.benchmark_id.replace(/-native(-registry)?$/, "-cis") ?? "";
  const startScan = useMutation({
    mutationFn: async () => {
      const profiles = await benchmarksApi.profiles(original);
      return scansApi.create({ name: `Scan ${asset?.name ?? ""}`.trim(), benchmark_id: original, profile_id: profiles[0].id, asset_ids: [assetId] });
    },
    onSuccess: (s) => navigate(`/scans/${s.id}`),
  });

  const online = (asset?.status ?? "unknown") === "online";
  const tabs: { id: DrawerTab; label: string }[] = [
    { id: "overview", label: L("Overview", "Ümumi") },
    { id: "findings", label: L("Findings", "Nəticələr") },
    { id: "hardening", label: L("Hardening", "Hardening") },
    { id: "logs", label: L("Logs", "Loglar") },
  ];
  const total = latest ? latest.passed + latest.failed + latest.errored : 0;

  // Rendered on document.body: inside the page the parent's space-y margin pushed the fixed panel 24px down.
  return createPortal(
    <div className={`fixed inset-0 z-40 bg-slate-950 ${closing ? "wd-panel-out" : "wd-panel-in"}`} role="dialog" aria-modal="true" aria-label="Host details">
      <aside className="flex h-full w-full flex-col bg-slate-950">
        <header className="border-b border-slate-800 px-6 pt-4">
         <div className="mx-auto w-full max-w-[1400px] space-y-4">
          <button onClick={close} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-800 px-3 text-sm text-slate-300 hover:bg-slate-900 hover:text-slate-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
            {L("Back to assets", "Assetlərə qayıt")}
          </button>
          <div className="flex items-start gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-2.5"><HostIcon os={asset?.os_type ?? agent?.os ?? "linux"} size={40} /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="truncate text-xl font-semibold tracking-tight text-slate-50">{asset?.name ?? agent?.hostname ?? `#${assetId}`}</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-0.5 text-xs text-slate-200">
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-slate-500"}`} />{online ? L("online", "onlayn") : asset?.status ?? "unknown"}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">{osLabel(asset?.os_type ?? agent?.os ?? "")} · {asset?.host}{agent && ` · ${L("agent", "agent")} v${agent.version ?? "1"}`}</p>
            </div>
            <div className="flex items-center gap-2">
              {canOperate && agent && agent.status !== "revoked" && (
                <button onClick={() => startScan.mutate()} disabled={startScan.isPending} className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-medium hover:bg-cyan-500 disabled:opacity-40">
                  {startScan.isPending ? "..." : L("Run scan", "Yoxlama başlat")}
                </button>
              )}
            </div>
          </div>
          {startScan.error && <p className="text-xs text-red-300">{(startScan.error as Error).message}</p>}
          <nav className="-mb-px flex gap-1" role="tablist" aria-label="host sections">
            {tabs.map((tb) => (
              <button key={tb.id} role="tab" aria-selected={tab === tb.id} onClick={() => onTab(tb.id)} className={`border-b-2 px-4 py-2.5 text-sm ${tab === tb.id ? "border-slate-100 font-medium text-slate-50" : "border-transparent text-slate-500 hover:text-slate-200"}`}>{tb.label}</button>
            ))}
          </nav>
         </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
         <div className="mx-auto w-full max-w-[1400px]">
          {tab === "overview" && (
            <div className="space-y-6">
              {!latest ? <EmptyState title={L("No scan results for this host yet", "Bu host üçün hələ yoxlama nəticəsi yoxdur")} hint={L("Run a scan to see compliance, findings and trends here.", "Uyğunluğu, nəticələri və trendi görmək üçün yoxlama başladın.")} /> : (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Stat label={L("Compliance", "Uyğunluq")} value={latest.score === null ? "-" : `${latest.score.toFixed(1)}%`} />
                    <Stat label={L("Passing", "Keçir")} value={latest.passed} tone="text-emerald-300" />
                    <Stat label={L("Failing", "Uğursuz")} value={latest.failed} tone={latest.failed ? "text-red-300" : undefined} />
                    <Stat label={L("Errors", "Xəta")} value={latest.errored} tone={latest.errored ? "text-amber-300" : undefined} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                      <div className="mb-2 text-sm font-medium text-slate-100">{L("Latest scan", "Son yoxlama")}</div>
                      <Ring centerValue={`${Math.round((latest.passed / Math.max(1, total)) * 100)}%`} centerLabel={L("passing", "keçir")} height={180} data={[{ name: "pass", value: latest.passed, color: c.pass }, { name: "fail", value: latest.failed, color: c.fail }, { name: "error", value: latest.errored, color: c.error }]} />
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                      <div className="mb-2 text-sm font-medium text-slate-100">{L("Compliance trend", "Uyğunluq trendi")}</div>
                      {(host.data?.trend.length ?? 0) < 2 ? <p className="py-12 text-center text-sm text-slate-500">{L("A trend appears after two scans.", "Trend iki yoxlamadan sonra görünür.")}</p> : (
                        <TrendArea height={180} domain={[0, 100]} xKey="when" data={(host.data?.trend ?? []).map((p) => ({ when: new Date(p.at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }), score: p.score ?? 0 }))} series={[{ key: "score", name: L("Compliance %", "Uyğunluq %"), color: c.line }]} />
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                    <div className="mb-2 text-sm font-medium text-slate-100">{L("By category", "Kateqoriya üzrə")}</div>
                    <Bars horizontal stacked yWidth={170} height={Math.max(180, (host.data?.categories.length ?? 0) * 34)} xKey="category" data={host.data?.categories ?? []} series={[{ key: "pass", name: "pass", color: c.pass }, { key: "fail", name: "fail", color: c.fail }, { key: "error", name: "error", color: c.error }]} />
                  </div>
                </>
              )}
              <dl className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-2">
                <Fact k={L("Hostname", "Host adı")}><span className="font-mono text-xs">{asset?.host ?? agent?.hostname}</span></Fact>
                <Fact k={L("Operating system", "Əməliyyat sistemi")}>{asset?.os_detected ?? osLabel(asset?.os_type ?? "")}</Fact>
                <Fact k="Agent">{agent ? <>v{agent.version ?? "1"} <span className="text-slate-500">·</span> <ShortId value={agent.id} /></> : L("No agent", "Agent yoxdur")}</Fact>
                <Fact k="Benchmark">{agent?.benchmark_id ?? "-"}</Fact>
                <Fact k={L("Last seen", "Son əlaqə")}>{agent?.last_seen ? new Date(agent.last_seen).toLocaleString() : "-"}</Fact>
                {asset && asset.tags.length > 0 && <Fact k={L("Tags", "Etiketlər")}>{asset.tags.join(", ")}</Fact>}
              </dl>
              <Link to={`/hosts/${assetId}`} className="inline-block text-sm text-slate-400 underline-offset-4 hover:text-slate-100 hover:underline">{L("Open full analytics page", "Tam analitika səhifəsini aç")}</Link>
            </div>
          )}

          {tab === "findings" && (
            <div className="space-y-4">
              {!latest ? <EmptyState title={L("No scan results yet", "Hələ nəticə yoxdur")} hint={L("Run a scan first.", "Əvvəlcə yoxlama başladın.")} /> : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Chips label="status" value={status} onChange={(v) => { setStatus(v); setMore(false); }} options={[{ id: "fail", label: L("Failing", "Uğursuz"), count: counts.fail }, { id: "error", label: L("Errors", "Xəta"), count: counts.error }, { id: "pass", label: L("Passing", "Keçir"), count: counts.pass }, { id: "all", label: L("All", "Hamısı"), count: counts.all }]} />
                    <input type="search" className={searchCls} placeholder={L("Search controls", "Nəzarət axtar")} value={q} onChange={(e) => setQ(e.target.value)} />
                  </div>
                  {results.isLoading || scanDetail.isLoading ? <p className="text-sm text-slate-500">...</p> : filtered.length === 0 ? <EmptyState title={L("Nothing in this view", "Bu görünüşdə heç nə yoxdur")} /> : (
                    <div className={tableWrap}>
                      <table className="w-full text-left text-sm">
                        <thead className={theadCls}><tr><th className="px-4 py-2.5 font-medium">{L("Control", "Nəzarət")}</th><th className="px-4 py-2.5 font-medium">{L("Severity", "Ciddilik")}</th><th className="px-4 py-2.5 font-medium">{L("Status", "Vəziyyət")}</th><th className="px-4 py-2.5 font-medium">{L("Actual", "Faktiki")}</th></tr></thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {(more ? filtered : filtered.slice(0, 30)).map((r) => (
                            <tr key={r.id} className="align-top hover:bg-slate-900/60">
                              <td className="px-4 py-2.5"><div className="text-slate-100">{r.title}</div><div className="font-mono text-xs text-slate-500">{r.control_id}</div></td>
                              <td className="px-4 py-2.5 text-xs text-slate-300">{r.severity}</td>
                              <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                              <td className="max-w-[16rem] truncate px-4 py-2.5 font-mono text-xs text-slate-400" title={r.actual ?? r.message ?? ""}>{r.actual ?? r.message ?? "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {filtered.length > 30 && <button onClick={() => setMore(!more)} className="w-full border-t border-slate-800 py-2.5 text-xs text-slate-400 hover:bg-slate-900 hover:text-slate-100">{more ? L("Show fewer", "Daha az göstər") : L(`Show all ${filtered.length}`, `Hamısını göstər (${filtered.length})`)}</button>}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "hardening" && (
            <div className="space-y-4">
              {runs.isLoading && <p className="text-sm text-slate-500">...</p>}
              {runs.data?.length === 0 && <EmptyState title={L("No hardening on this host yet", "Bu hostda hələ hardening yoxdur")} hint={L("Start a hardening run from the Hardening page.", "Hardening səhifəsindən iş başladın.")} />}
              {runs.data?.map(({ run, mine }) => {
                const n = (s: string) => mine.filter((ch) => ch.status === s).length;
                return (
                  <Link key={run.id} to={`/hardening/${run.id}`} className="block rounded-xl border border-slate-800 bg-slate-900/60 p-4 hover:border-slate-600">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium text-slate-100">{run.name}</div>
                      <StatusPill status={run.status} />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{new Date(run.created_at).toLocaleString()} · {mine.length} {L("changes on this host", "dəyişiklik bu hostda")}</div>
                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300">
                      <span><span className="text-emerald-300">{n("applied")}</span> {L("applied", "tətbiq")}</span>
                      <span><span className="text-slate-200">{n("skipped")}</span> {L("skipped", "keçildi")}</span>
                      <span><span className="text-red-300">{n("failed")}</span> {L("failed", "uğursuz")}</span>
                      <span><span className="text-slate-200">{mine.filter((ch) => ch.rollback_status === "reverted").length}</span> {L("rolled back", "geri qaytarıldı")}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {tab === "logs" && (agent ? <AgentLogs agentId={agent.id} tall /> : <EmptyState title={L("This host has no agent", "Bu hostda agent yoxdur")} hint={L("Logs come from the agent running on the workstation.", "Loglar workstation-da işləyən agentdən gəlir.")} />)}
         </div>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
