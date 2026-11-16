import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { benchmarksApi } from "../benchmarksApi";
import { hardeningApi, RunSummary } from "../hardeningApi";
import { pamApi } from "../pamApi";
import { scansApi } from "../scansApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";
import DataTable, { Column } from "../components/DataTable";
import { PageHeader, searchCls } from "../components/ui";
import { isPam } from "../types";
import ScanResultPicker from "../components/ScanResultPicker";

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

/**
 * Starts a PAM hardening run. For each host and control core checks first, captures a backup,
 * runs the remediation and checks again. Risky controls get a safety net that reverts the change
 * unless core can sign in again afterwards. Every applied change can be rolled back from the run page.
 */
function NewPamHardening({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const L = (en: string, a: string) => (lang === "az" ? a : en);
  const navigate = useNavigate();
  const benchmarks = useQuery({ queryKey: ["pam-benchmarks"], queryFn: pamApi.benchmarks });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list });
  const [bid, setBid] = useState("");
  const [hosts, setHosts] = useState<Set<number>>(new Set());
  const [controls, setControls] = useState<Set<string>>(new Set());
  const [scanId, setScanId] = useState("");
  const [filter, setFilter] = useState("");
  const [confirmRisky, setConfirmRisky] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeBid = bid || benchmarks.data?.[0]?.id || "";
  const bench = benchmarks.data?.find((b) => b.id === activeBid);
  const catalog = useQuery({ queryKey: ["controls", activeBid], queryFn: () => benchmarksApi.controls(activeBid), enabled: !!activeBid });
  const eligible = useMemo(() => (assets.data ?? []).filter((a) => isPam(a) && bench && a.os_type === bench.os), [assets.data, bench]);
  // Every earlier PAM scan with results, newest first; choosing one switches to its benchmark.
  const pamScans = (scans.data ?? []).filter((s) => s.mode === "pam" && s.done_checks > 0).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = (catalog.data ?? []).filter((c) => !filter.trim() || `${c.id} ${c.title} ${c.category}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const riskyPicked = (catalog.data ?? []).filter((c) => c.risky && controls.has(c.id)).length;

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  const fromScan = (id: string) => {
    setScanId(id);
    setError(null);
    const scan = pamScans.find((s) => s.id === id);
    if (scan && scan.benchmark_id !== activeBid) {
      setBid(scan.benchmark_id);
      setHosts(new Set());
      setControls(new Set());
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const run = await pamApi.harden({ name: name.trim() || undefined, benchmark_id: activeBid, asset_ids: Array.from(hosts), rule_ids: Array.from(controls), confirm_risky: confirmRisky, scan_id: scanId || null });
      navigate(`/pam/hardening/${run.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-full w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-lg font-semibold">{L("New PAM hardening run", "Yeni PAM möhkəmləndirməsi")}</h2>
          <p className="mt-1 text-xs text-slate-400">{L("For each change core checks first, saves a backup, applies the fix and checks again. Controls that already pass are skipped. Every change can be rolled back from the run page.", "Hər dəyişiklik üçün core əvvəlcə yoxlayır, ehtiyat nüsxə saxlayır, düzəlişi tətbiq edir və yenidən yoxlayır. Artıq uyğun olan nəzarətlər ötürülür. Hər dəyişiklik icra səhifəsindən geri qaytarıla bilər.")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm"><span className="text-slate-300">Benchmark</span>
            <select className={field} value={activeBid} onChange={(e) => { setBid(e.target.value); setHosts(new Set()); setControls(new Set()); setScanId(""); }}>
              {(benchmarks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="text-slate-300">{L("Start from a PAM scan (optional)", "PAM skanından başla (istəyə bağlı)")}</span>
            <select className={field} value={scanId} onChange={(e) => fromScan(e.target.value)}>
              <option value="">{L("No scan", "Skan yoxdur")}</option>
              {pamScans.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.status} · {new Date(s.created_at).toLocaleString()}</option>)}
            </select>
          </label>
        </div>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm text-slate-300">{L("PAM hosts", "PAM hostları")} ({hosts.size})</legend>
          {eligible.length === 0 && <p className="text-xs text-slate-500">{L("No PAM host with this OS.", "Bu OS ilə PAM hostu yoxdur.")}</p>}
          {eligible.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={hosts.has(a.id)} disabled={!a.credential_username} onChange={() => toggle(hosts, a.id, setHosts)} />
              <span className="text-slate-100">{a.name}</span>
              <span className="font-mono text-xs text-slate-500">{a.host} · {a.connection === "winrm" ? "WinRM" : "SSH"}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm text-slate-300">{L("Controls", "Nəzarətlər")} ({controls.size})</legend>
          {scanId && <ScanResultPicker scanId={scanId} known={new Set((catalog.data ?? []).map((c) => c.id))} onSelect={(ids) => setControls(new Set(ids))} />}
          <div className="flex flex-wrap gap-2">
            <input type="search" className={`${searchCls} !max-w-xs`} placeholder={L("Filter controls", "Nəzarətləri süz")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="rounded-md border border-slate-700 px-3 text-xs hover:bg-slate-800" onClick={() => setControls(new Set([...controls, ...shown.map((c) => c.id)]))}>{L("Select shown", "Göstəriləni seç")}</button>
            <button type="button" className="rounded-md border border-slate-700 px-3 text-xs hover:bg-slate-800" onClick={() => setControls(new Set())}>{L("Clear", "Təmizlə")}</button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-slate-800 p-2">
            {shown.map((c) => (
              <label key={c.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={controls.has(c.id)} onChange={() => toggle(controls, c.id, setControls)} />
                <span>
                  <span className={`font-mono text-xs ${c.risky ? "text-red-400" : "text-slate-400"}`}>{c.id}</span> <span className={c.risky ? "font-medium text-red-400" : "text-slate-100"}>{c.title}</span>
                  <span className="ml-2 text-xs text-slate-500">{c.severity}{c.reboot_required ? ` · ${L("reboot", "yenidən başlatma")}` : ""}</span>
                  {c.risky && <span className="ml-2 rounded bg-red-950 px-2 py-0.5 text-xs text-red-300">{L("risky", "riskli")}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {riskyPicked > 0 && (
          <label className="flex items-start gap-2 rounded-md border border-amber-800 bg-slate-950 p-3 text-sm text-amber-200">
            <input type="checkbox" className="mt-1" checked={confirmRisky} onChange={(e) => setConfirmRisky(e.target.checked)} />
            <span>{L(`${riskyPicked} risky control(s) can affect remote access. Each one is applied last, with a safety net that reverts it after 2 minutes unless core can sign in again.`, `${riskyPicked} riskli nəzarət uzaqdan girişə təsir edə bilər. Hər biri sonda tətbiq olunur və core yenidən daxil ola bilməsə 2 dəqiqədən sonra geri qaytarılır.`)}</span>
          </label>
        )}
        <label className="block text-sm"><span className="text-slate-300">{L("Run name (optional)", "İcra adı (istəyə bağlı)")}</span>
          <input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">{L("Cancel", "Ləğv et")}</button>
          <button disabled={busy || hosts.size === 0 || controls.size === 0 || (riskyPicked > 0 && !confirmRisky)} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
            {busy ? L("Starting...", "Başlayır...") : L("Apply hardening", "Möhkəmləndirməni tətbiq et")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function PamHardening() {
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const L = (en: string, a: string) => (lang === "az" ? a : en);
  const navigate = useNavigate();
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const runs = useQuery({ queryKey: ["runs"], queryFn: hardeningApi.runs, refetchInterval: 5_000 });
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => (runs.data ?? []).filter((r) => r.mode === "pam"), [runs.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => !needle || `${r.name} ${r.benchmark_id} ${r.created_by} ${r.status}`.toLowerCase().includes(needle));
  }, [all, q]);
  const columns: Column<RunSummary>[] = [
    { id: "name", header: L("Run", "İcra"), locked: true, sort: (a, b) => a.name.localeCompare(b.name), csv: (r) => r.name,
      cell: (r) => (<><Link to={`/pam/hardening/${r.id}`} className="font-medium text-slate-50 hover:underline">{r.name}</Link><div className="text-xs text-slate-500">{r.created_by}</div></>) },
    { id: "benchmark", header: "Benchmark", sort: (a, b) => a.benchmark_id.localeCompare(b.benchmark_id), csv: (r) => r.benchmark_id, cell: (r) => <span className="font-mono text-xs text-slate-400">{r.benchmark_id}</span> },
    { id: "hosts", header: t("col.hosts"), sort: (a, b) => a.host_count - b.host_count, csv: (r) => r.host_count, cell: (r) => r.host_count },
    { id: "status", header: t("col.status"), sort: (a, b) => a.status.localeCompare(b.status), csv: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    { id: "progress", header: t("col.progress"), csv: (r) => `${r.done_changes}/${r.total_changes}`, cell: (r) => <span className="text-xs text-slate-400">{Math.min(r.done_changes, r.total_changes)} / {r.total_changes} · {r.applied_count} {L("applied", "tətbiq olunub")}</span> },
    { id: "created", header: t("col.started"), sort: (a, b) => a.created_at.localeCompare(b.created_at), csv: (r) => r.created_at, cell: (r) => <span className="whitespace-nowrap text-xs text-slate-400">{new Date(r.created_at).toLocaleString()}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title={L("PAM hardening", "PAM möhkəmləndirmə")}
        subtitle={L("Changes applied by core over SSH or WinRM, with a backup for each. Open a run to see every change and roll changes back.", "Core tərəfindən SSH və ya WinRM üzərindən, hər biri ehtiyat nüsxə ilə tətbiq olunan dəyişikliklər. Hər dəyişikliyi görmək və geri qaytarmaq üçün icranı açın.")}
        action={canOperate && <button onClick={() => setCreating(true)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500">{L("New PAM hardening", "Yeni PAM möhkəmləndirməsi")}</button>}
      />
      {runs.error && <p className="text-red-400">{(runs.error as Error).message}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="pam-runs"
        exportName="pam-hardening"
        loading={runs.isLoading}
        initialSort={{ id: "created", dir: "desc" }}
        onRowClick={(r) => navigate(`/pam/hardening/${r.id}`)}
        emptyTitle={L("No PAM hardening runs yet", "Hələ PAM möhkəmləndirməsi yoxdur")}
        toolbar={<input type="search" className={searchCls} placeholder={L("Search runs", "İcraları axtar")} value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      {creating && <NewPamHardening onClose={() => setCreating(false)} />}
    </div>
  );
}
