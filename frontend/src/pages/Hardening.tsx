import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "../agentsApi";
import { assetsApi } from "../assetsApi";
import { benchmarksApi } from "../benchmarksApi";
import { scansApi } from "../scansApi";
import { hardeningApi, Plan, RunSummary, shortId } from "../hardeningApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";
import DataTable, { Column } from "../components/DataTable";
import { Chips, PageHeader, searchCls } from "../components/ui";
import SearchBox, { matchesSearch } from "../components/SearchBox";

const field = "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

/**
 * Step-by-step hardening: pick hosts and a source scan, review the plan (dry run), confirm, then apply.
 * The Benchmarks page opens it with a benchmark and controls already chosen.
 */
export function NewHardening({
  onClose,
  initialBenchmarkId,
  initialControlIds,
}: {
  onClose: () => void;
  initialBenchmarkId?: string;
  initialControlIds?: string[];
}) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const benches = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list });

  const [bid, setBid] = useState(initialBenchmarkId ?? "");
  // Pick the benchmark that matches an enrolled host instead of the first one alphabetically; hide internal native manifests.
  const readable = useMemo(() => {
    const all = benches.data ?? [];
    const named = all.filter((b) => !b.id.includes("native"));
    return named.length ? named : all;
  }, [benches.data]);
  const hostOs = new Set((assets.data ?? []).map((a) => a.os_type));
  const agentList = useQuery({ queryKey: ["agents"], queryFn: agentsApi.list });
  // An enrolled agent names its exact benchmark (for example ubuntu-24.04-native); map it to the readable one.
  const fromAgent = (agentList.data ?? []).map((g) => g.benchmark_id.replace(/-native(-registry)?$/, "-cis")).find((id) => readable.some((b) => b.id === id));
  const activeBid = bid || fromAgent || readable.find((b) => hostOs.has(b.os as never))?.id || readable[0]?.id || "";
  const [controlFilter, setControlFilter] = useState("");
  const bench = benches.data?.find((b) => b.id === activeBid);
  const [hosts, setHosts] = useState<Set<number>>(new Set());
  const [scanId, setScanId] = useState("");
  const [name, setName] = useState("");
  const [controls, setControls] = useState<Set<string>>(() => new Set(initialControlIds ?? []));
  const [review, setReview] = useState<{ key: string; plan: Plan } | null>(null);
  const selectionKey = JSON.stringify([activeBid, scanId, Array.from(hosts).sort((a, b) => a - b), Array.from(controls).sort()]);
  const plan = review?.key === selectionKey ? review.plan : null;
  const [confirmRisky, setConfirmRisky] = useState(false);
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [planning, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const busy = planning || applying;
  const planRequest = useRef(0);
  const selectionRequest = useRef(0);
  useEffect(() => {
    planRequest.current++;
    selectionRequest.current++;
    setReview(null);
    setConfirmRisky(false);
    setBusy(false);
  }, [selectionKey]);

  const eligible = useMemo(() => (assets.data ?? []).filter((a) => bench && a.os_type === bench.os), [assets.data, bench]);
  const profile = useQuery({
    queryKey: ["controls", activeBid],
    queryFn: () => benchmarksApi.controls(activeBid),
    enabled: !!activeBid,
  });
  const riskyPicked = (plan?.controls ?? []).filter((c) => c.risky).length;

  // Failed controls from the chosen scan are preselected: hardening starts from a check result.
  const preselectFromScan = async () => {
    if (!scanId) return;
    const requestId = ++selectionRequest.current;
    const generation = planRequest.current;
    setError(null);
    try {
      const failed = await scansApi.results(scanId, undefined, "fail");
      if (requestId === selectionRequest.current && generation === planRequest.current) {
        setControls(new Set(failed.map((r) => r.control_id)));
      }
    } catch (err) {
      if (requestId === selectionRequest.current && generation === planRequest.current) {
        setError(err instanceof Error ? err.message : t("hard.planFailed"));
      }
    }
  };

  const doPlan = async () => {
    if (applying) return;
    const requestId = ++planRequest.current;
    setReview(null);
    setConfirmRisky(false);
    setError(null);
    setBusy(true);
    try {
      const next = await hardeningApi.plan({ benchmark_id: activeBid, control_ids: Array.from(controls), asset_ids: Array.from(hosts), scan_id: scanId || undefined });
      if (requestId === planRequest.current) setReview({ key: selectionKey, plan: next });
    } catch (err) {
      if (requestId === planRequest.current) setError(err instanceof Error ? err.message : t("hard.planFailed"));
    } finally {
      if (requestId === planRequest.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (step === 3 && !plan && !busy && !error && !applying) void doPlan();
    // doPlan reads the latest selection; the selection key changes whenever the review must be recomputed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, selectionKey, plan]);

  const apply = async () => {
    if (!plan || busy || (riskyPicked > 0 && !confirmRisky)) return;
    setError(null);
    setApplying(true);
    try {
      const run = await hardeningApi.create({
        name: name.trim() || undefined,
        benchmark_id: activeBid,
        control_ids: Array.from(controls),
        asset_ids: Array.from(hosts),
        scan_id: scanId || undefined,
        confirm_risky: confirmRisky,
      });
      navigate(`/hardening/${run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("hard.startFailed"));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={t("hard.newRun")}>
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-slate-800 bg-slate-900 sm:max-h-[92vh] sm:rounded-xl">
        <div className="space-y-4 border-b border-slate-800 px-5 pb-4 pt-5 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-50">{t("hard.newRun")}</h2>
            <p className="text-sm text-slate-500">{t("hard.intro")}</p>
          </div>
          <ol className="flex items-center gap-2 text-xs" aria-label="steps">
            {[L("Target", "Hədəf"), L("Controls", "Nəzarətlər"), L("Review and apply", "Baxış və tətbiq")].map((label, i) => {
              const n = i + 1;
              const reachable = n < step || (n === 2 && hosts.size > 0) || (n === 3 && hosts.size > 0 && controls.size > 0);
              return (
                <li key={label} className="flex min-w-0 flex-1 items-center gap-2">
                  <button disabled={!reachable && n !== step} onClick={() => setStep(n)} aria-current={step === n ? "step" : undefined} className={`flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 ${step === n ? "border-slate-100 bg-slate-100 text-slate-950" : n < step ? "border-slate-600 text-slate-200" : "border-slate-800 text-slate-500"}`}>
                    <span className="font-semibold">{n}</span>
                    <span className="truncate">{label}</span>
                  </button>
                  {n < 3 && <span aria-hidden className="h-px flex-1 bg-slate-800" />}
                </li>
              );
            })}
          </ol>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
          {step === 1 && (
            <>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="text-slate-300">{t("hard.benchmark")}</span>
            <select className={`${field} mt-1 w-full`} value={activeBid} onChange={(e) => { setBid(e.target.value); setControls(new Set()); setReview(null); }}>
              {readable.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-300">{t("hard.fromScan")}</span>
            <select className={`${field} mt-1 w-full`} value={scanId} onChange={(e) => setScanId(e.target.value)}>
              <option value="">{t("hard.noScan")}</option>
              {(scans.data ?? []).filter((s) => s.benchmark_id === activeBid).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-slate-200">1. {t("hard.hosts")}</legend>
          <ul className="mt-2 space-y-1">
            {eligible.map((a) => (
              <li key={a.id}>
                <label className="flex items-center gap-3 rounded px-2 py-1 hover:bg-slate-800">
                  <input type="checkbox" checked={hosts.has(a.id)} onChange={() => setHosts((s) => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; })} />
                  <span>{a.name}</span><span className="font-mono text-xs text-slate-400">{a.host}</span>
                </label>
              </li>
            ))}
            {eligible.length === 0 && <li className="text-sm text-slate-400">{t("hard.noHosts")}</li>}
          </ul>
        </fieldset>

            </>
          )}
          {step === 2 && (
            <>
        <fieldset>
          <div className="flex items-center justify-between">
            <legend className="text-sm font-medium text-slate-200">2. {t("hard.controls")} ({controls.size} {t("hard.selected")})</legend>
            <div className="flex gap-3 text-sm">
              <button onClick={preselectFromScan} disabled={!scanId} className="text-cyan-300 hover:underline disabled:opacity-40">{t("hard.selectFailed")}</button>
              <button onClick={() => setControls(new Set((profile.data ?? []).map((c) => c.id)))} className="text-cyan-300 hover:underline">{t("hard.selectAll")}</button>
              <button onClick={() => setControls(new Set())} className="text-slate-400 hover:underline">{t("common.clear")}</button>
            </div>
          </div>
          <input type="search" value={controlFilter} onChange={(e) => setControlFilter(e.target.value)} placeholder="Filter controls" className={`${field} mt-2 w-full`} aria-label="filter controls" />
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {(profile.data ?? []).filter((c) => !controlFilter.trim() || c.title.toLowerCase().includes(controlFilter.trim().toLowerCase()) || c.id.toLowerCase().includes(controlFilter.trim().toLowerCase())).map((c) => (
              <li key={c.id}>
                <label className="flex items-center gap-3 rounded px-2 py-1 text-sm hover:bg-slate-800">
                  <input type="checkbox" checked={controls.has(c.id)} onChange={() => setControls((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} />
                  <span className="flex-1">{c.title}</span>
                  <span className="text-xs text-slate-400">{c.severity}</span>
                  {c.risky && <span className="rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">{t("hard.risky")}</span>}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

            </>
          )}
          {step === 3 && (
            <>
        <label className="block text-sm">
          <span className="text-slate-300">{t("hard.nameOpt")}</span>
          <input
            className={`${field} mt-1 w-full`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder={t("hard.namePh")}
          />
          <span className="mt-1 block text-xs text-slate-500">{t("hard.nameHint")}</span>
        </label>

              {busy && !plan && <p className="text-sm text-slate-500">{L("Preparing the dry run...", "Sınaq planı hazırlanır...")}</p>}
        {plan && (
          <div className="space-y-3 rounded-lg border border-slate-800 p-4 text-sm">
            <div className="font-medium">{t("hard.planSummary").replace("{c}", String(plan.controls.length)).replace("{h}", String(plan.hosts.length))}</div>
            {plan.warnings.map((w) => <p key={w} className="text-amber-300">{w}</p>)}
            <ol className="max-h-72 space-y-2 overflow-y-auto">
              {plan.controls.map((c) => (
                <li key={c.id} className="rounded bg-slate-950 p-2">
                  <div className="font-medium">{c.title} <span className="font-mono text-xs text-slate-500">{c.id}</span></div>
                  <pre className="mt-1 overflow-x-auto text-xs text-slate-300">{c.commands}</pre>
                  <div className="text-xs text-slate-500">{t("hard.backsUp")} {c.backups.join(", ") || t("hard.nothing")} · {t("hard.rollbackLabel")} {c.rollback}{c.reboot_required ? ` · ${t("hard.reboot")}` : ""}</div>
                </li>
              ))}
            </ol>
            {riskyPicked > 0 && (
              <label className="flex items-start gap-2 rounded bg-red-950/40 p-3 text-red-200">
                <input type="checkbox" className="mt-1" checked={confirmRisky} onChange={(e) => setConfirmRisky(e.target.checked)} />
                <span>{t("hard.riskyWarn").replace("{n}", String(riskyPicked))}</span>
              </label>
            )}
          </div>
        )}

            </>
          )}
        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-5 py-4 sm:px-6">
          <button onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">{t("common.cancel")}</button>
          <div className="flex gap-2">
            {step > 1 && <button onClick={() => setStep(step - 1)} className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">{L("Back", "Geri")}</button>}
            {step < 3 && (
              <button onClick={() => setStep(step + 1)} disabled={step === 1 ? hosts.size === 0 : controls.size === 0} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500 disabled:opacity-40">
                {L("Next", "Növbəti")}
              </button>
            )}
            {step === 3 && (
              <button onClick={apply} disabled={!plan || busy || (riskyPicked > 0 && !confirmRisky)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500 disabled:opacity-40">
                {t("hard.apply")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Hardening() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const [creating, setCreating] = useState(false);
  const runs = useQuery({ queryKey: ["runs"], queryFn: hardeningApi.runs, refetchInterval: 5_000 });
  type RunFilter = "all" | "active" | "completed" | "failed" | "rolled_back";
  const [filter, setFilter] = useState<RunFilter>("all");
  const [search, setSearch] = useState("");
  const all = runs.data ?? [];
  const isActive = (r: RunSummary) => ["queued", "running"].includes(r.status);
  const shown = useMemo(
    () =>
      all.filter((r) => {
        const inFilter = filter === "all" || (filter === "active" ? isActive(r) : filter === "completed" ? r.status === "completed" : filter === "rolled_back" ? r.status === "rolled_back" : r.status.includes("fail"));
        return inFilter && matchesSearch(search, [r.name, shortId("H", r.id), r.created_by, r.status.replace(/_/g, " ")]);
      }),
    [all, filter, search],
  );

  const columns: Column<RunSummary>[] = [
    { id: "id", header: t("col.id"), defaultHidden: true, csv: (r) => shortId("H", r.id), cell: (r) => <span className="font-mono text-xs text-slate-400">{shortId("H", r.id)}</span> },
    {
      id: "run", header: t("hard.run"), locked: true, sort: (a, b) => a.name.localeCompare(b.name), csv: (r) => r.name,
      cell: (r) => (
        <>
          <Link to={`/hardening/${r.id}`} className="font-medium text-slate-50 hover:underline">{r.name}</Link>
          <div className="font-mono text-[11px] text-slate-500">{shortId("H", r.id)}</div>
        </>
      ),
    },
    { id: "status", header: t("col.status"), sort: (a, b) => a.status.localeCompare(b.status), csv: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    {
      id: "progress", header: t("col.progress"), sort: (a, b) => a.done_changes / Math.max(1, a.total_changes) - b.done_changes / Math.max(1, b.total_changes),
      csv: (r) => `${Math.min(r.done_changes, r.total_changes)}/${r.total_changes}`,
      cell: (r) => <span className="text-slate-400">{Math.min(r.done_changes, r.total_changes)} / {r.total_changes}</span>,
    },
    { id: "applied", header: t("hard.applied"), sort: (a, b) => a.applied_count - b.applied_count, csv: (r) => r.applied_count, cell: (r) => r.applied_count },
    { id: "hosts", header: t("col.hosts"), defaultHidden: true, sort: (a, b) => a.host_count - b.host_count, csv: (r) => r.host_count, cell: (r) => r.host_count },
    { id: "by", header: t("rb.startedBy"), defaultHidden: true, csv: (r) => r.created_by, cell: (r) => <span className="text-xs text-slate-300">{r.created_by}</span> },
    {
      id: "started", header: t("col.started"), sort: (a, b) => (a.started_at ?? a.created_at).localeCompare(b.started_at ?? b.created_at), csv: (r) => r.started_at ?? r.created_at,
      cell: (r) => <span className="whitespace-nowrap text-xs text-slate-400">{r.started_at ? new Date(r.started_at).toLocaleString() : "-"}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("hard.title")}
        subtitle={t("hard.subtitle")}
        action={canOperate && <button onClick={() => setCreating(true)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500">{t("hard.newRun")}</button>}
      />
      <DataTable
        rows={shown}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="hardening-runs"
        exportName="hardening-runs"
        loading={runs.isLoading}
        initialSort={{ id: "started", dir: "desc" }}
        emptyTitle={all.length === 0 ? t("hard.noRuns") : t("search.none")}
        emptyHint={all.length === 0 ? L("Pick failing controls from a scan and apply them with a backup.", "Scan-dan uğursuz nəzarətləri seçib ehtiyat nüsxə ilə tətbiq edin.") : L("Try another filter or search.", "Başqa süzgəc və ya axtarış sınayın.")}
        toolbar={
          <>
            <Chips<RunFilter>
              label="run status"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: L("All", "Hamısı"), count: all.length },
                { id: "active", label: L("Running", "İcrada"), count: all.filter(isActive).length },
                { id: "completed", label: L("Completed", "Tamamlanıb"), count: all.filter((r) => r.status === "completed").length },
                { id: "rolled_back", label: L("Rolled back", "Geri qaytarılıb"), count: all.filter((r) => r.status === "rolled_back").length },
                { id: "failed", label: L("Failed", "Uğursuz"), count: all.filter((r) => r.status.includes("fail")).length },
              ]}
            />
            <input type="search" className={searchCls} placeholder={t("search.hardening")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </>
        }
        mobileCard={(r) => (
          <Link to={`/hardening/${r.id}`} className="block rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-slate-50">{r.name}</span>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-1 text-xs text-slate-500">{Math.min(r.done_changes, r.total_changes)} / {r.total_changes} · {r.applied_count} {t("hard.applied")}</div>
          </Link>
        )}
      />
      {creating && <NewHardening onClose={() => setCreating(false)} />}
    </div>
  );
}
