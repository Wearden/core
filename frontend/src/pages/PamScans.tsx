import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { benchmarksApi } from "../benchmarksApi";
import { pamApi } from "../pamApi";
import { scansApi, ScanSummary } from "../scansApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import StatusPill from "../components/StatusPill";
import DataTable, { Column } from "../components/DataTable";
import { PageHeader, searchCls } from "../components/ui";
import { isPam } from "../types";
import { dateTime, isoTime } from "../time";

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-cyan-500";

/** Starts a PAM scan: core runs the benchmark's audit commands over SSH or WinRM. */
function NewPamScan({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const L = (en: string, a: string) => (lang === "az" ? a : en);
  const navigate = useNavigate();
  const benchmarks = useQuery({ queryKey: ["pam-benchmarks"], queryFn: pamApi.benchmarks });
  const assets = useQuery({ queryKey: ["assets"], queryFn: assetsApi.list });
  const [bid, setBid] = useState("");
  const [profileId, setProfileId] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeBid = bid || benchmarks.data?.[0]?.id || "";
  const bench = benchmarks.data?.find((b) => b.id === activeBid);
  const profiles = useQuery({ queryKey: ["profiles", activeBid], queryFn: () => benchmarksApi.profiles(activeBid), enabled: !!activeBid });
  const activeProfile = profileId || profiles.data?.[0]?.id || "";
  const hosts = useMemo(() => (assets.data ?? []).filter((a) => isPam(a) && bench && a.os_type === bench.os), [assets.data, bench]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const scan = await pamApi.scan({ name: name.trim() || undefined, benchmark_id: activeBid, profile_id: activeProfile, asset_ids: Array.from(picked) });
      navigate(`/pam/scans/${scan.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="max-h-full w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-lg font-semibold">{L("New PAM scan", "Yeni PAM skanı")}</h2>
          <p className="mt-1 text-xs text-slate-400">{L("Core signs in to each host and runs the benchmark's read-only audit commands. Nothing is changed.", "Core hər hosta daxil olur və benchmark-ın yalnız oxuyan yoxlama əmrlərini icra edir. Heç nə dəyişdirilmir.")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm"><span className="text-slate-300">Benchmark</span>
            <select className={field} value={activeBid} onChange={(e) => { setBid(e.target.value); setProfileId(""); setPicked(new Set()); }}>
              {(benchmarks.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="text-sm"><span className="text-slate-300">{L("Profile", "Profil")}</span>
            <select className={field} value={activeProfile} onChange={(e) => setProfileId(e.target.value)}>
              {(profiles.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.control_ids.length})</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm"><span className="text-slate-300">{L("Scan name (optional)", "Skan adı (istəyə bağlı)")}</span>
          <input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm text-slate-300">{L("PAM hosts", "PAM hostları")} ({picked.size})</legend>
          {hosts.length === 0 && <p className="text-xs text-slate-500">{L("No PAM host with this OS. Add one on the PAM assets page.", "Bu OS ilə PAM hostu yoxdur. PAM aktivləri səhifəsində əlavə edin.")}</p>}
          {hosts.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.has(a.id)} disabled={!a.credential_username} onChange={() => { const next = new Set(picked); if (next.has(a.id)) next.delete(a.id); else next.add(a.id); setPicked(next); }} />
              <span className="text-slate-100">{a.name}</span>
              <span className="font-mono text-xs text-slate-500">{a.host} · {a.connection === "winrm" ? "WinRM" : "SSH"}</span>
              {!a.credential_username && <span className="text-xs text-amber-300">{L("no credential", "etimad məlumatı yoxdur")}</span>}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">{L("Cancel", "Ləğv et")}</button>
          <button disabled={busy || picked.size === 0 || !activeProfile} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50">{busy ? L("Starting...", "Başlayır...") : L("Start scan", "Skanı başlat")}</button>
        </div>
      </form>
    </div>
  );
}

export default function PamScans() {
  const { user } = useAuth();
  const { lang, t } = useI18n();
  const L = (en: string, a: string) => (lang === "az" ? a : en);
  const navigate = useNavigate();
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const scans = useQuery({ queryKey: ["scans"], queryFn: scansApi.list, refetchInterval: 5_000 });
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState("");
  const all = useMemo(() => (scans.data ?? []).filter((s) => s.mode === "pam"), [scans.data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((s) => !needle || `${s.name} ${s.benchmark_id} ${s.created_by} ${s.status}`.toLowerCase().includes(needle));
  }, [all, q]);
  const columns: Column<ScanSummary>[] = [
    { id: "name", header: t("col.scan"), locked: true, sort: (a, b) => a.name.localeCompare(b.name), csv: (s) => s.name,
      cell: (s) => (<><Link to={`/pam/scans/${s.id}`} className="font-medium text-slate-50 hover:underline">{s.name}</Link><div className="text-xs text-slate-500">{s.created_by}</div></>) },
    { id: "benchmark", header: "Benchmark", sort: (a, b) => a.benchmark_id.localeCompare(b.benchmark_id), csv: (s) => s.benchmark_id, cell: (s) => <span className="font-mono text-xs text-slate-400">{s.benchmark_id}</span> },
    { id: "hosts", header: t("col.hosts"), sort: (a, b) => a.host_count - b.host_count, csv: (s) => s.host_count, cell: (s) => s.host_count },
    { id: "status", header: t("col.status"), sort: (a, b) => a.status.localeCompare(b.status), csv: (s) => s.status, cell: (s) => <StatusPill status={s.status} /> },
    { id: "progress", header: t("col.progress"), csv: (s) => `${s.done_checks}/${s.total_checks}`, cell: (s) => <span className="text-xs text-slate-400">{s.done_checks} / {s.total_checks}</span> },
    { id: "started", header: t("col.started"), sort: (a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""), csv: (s) => isoTime(s.started_at), cell: (s) => <span className="whitespace-nowrap text-xs text-slate-400">{s.started_at ? dateTime(s.started_at) : "-"}</span> },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        title={L("PAM scans", "PAM skanları")}
        subtitle={L("Compliance checks run by core over SSH or WinRM, without an agent. Read-only.", "Core tərəfindən agentsiz, SSH və ya WinRM üzərindən icra olunan uyğunluq yoxlamaları. Yalnız oxuma.")}
        action={canOperate && <button onClick={() => setCreating(true)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500">{L("New PAM scan", "Yeni PAM skanı")}</button>}
      />
      {scans.error && <p className="text-red-400">{(scans.error as Error).message}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        storageKey="pam-scans"
        exportName="pam-scans"
        loading={scans.isLoading}
        initialSort={{ id: "started", dir: "desc" }}
        onRowClick={(s) => navigate(`/pam/scans/${s.id}`)}
        emptyTitle={L("No PAM scans yet", "Hələ PAM skanı yoxdur")}
        toolbar={<input type="search" className={searchCls} placeholder={t("search.scans")} value={q} onChange={(e) => setQ(e.target.value)} />}
      />
      {creating && <NewPamScan onClose={() => setCreating(false)} />}
    </div>
  );
}
