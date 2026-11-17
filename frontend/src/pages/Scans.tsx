import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { scansApi, ScanDetail, ScanSummary } from "../scansApi";
import NewScanModal from "../components/NewScanModal";
import StatusPill from "../components/StatusPill";
import DataTable, { Column } from "../components/DataTable";
import { Chips, PageHeader, searchCls } from "../components/ui";
import AiBadge from "../components/AiBadge";
import { aiApi } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { dateTime, isoTime } from "../time";

type Filter = "all" | "active" | "completed" | "failed";
const ACTIVE = ["queued", "running", "cancel_requested"];

function Progress({ s }: { s: ScanSummary }) {
  const pct = s.total_checks ? Math.round((s.done_checks / s.total_checks) * 100) : 0;
  return (
    <div className="min-w-32">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-slate-500">{s.done_checks} / {s.total_checks}</div>
    </div>
  );
}

export default function Scans() {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const navigate = useNavigate();
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const [creating, setCreating] = useState(false);
  const { data: allScans = [], isLoading, error } = useQuery({ queryKey: ["scans"], queryFn: scansApi.list, refetchInterval: 5_000 });
  // PAM scans are listed on the PAM scans page.
  const data = useMemo(() => allScans.filter((s) => s.mode !== "pam"), [allScans]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => ({
    all: data.length,
    active: data.filter((s) => ACTIVE.includes(s.status)).length,
    completed: data.filter((s) => s.status === "completed").length,
    failed: data.filter((s) => s.status === "failed" || s.status === "cancelled").length,
  }), [data]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((s) => {
      const inFilter = filter === "all" || (filter === "active" ? ACTIVE.includes(s.status) : filter === "completed" ? s.status === "completed" : s.status === "failed" || s.status === "cancelled");
      return inFilter && (!needle || `${s.name} ${s.profile_name} ${s.created_by} ${s.status}`.toLowerCase().includes(needle));
    });
  }, [data, filter, q]);

  const aiList = useQuery({ queryKey: ["ai-analyses"], queryFn: aiApi.list, staleTime: 60_000 });
  const aiByScan = new Map((aiList.data ?? []).map((a) => [a.scan_id, a]));
  const columns: Column<ScanSummary>[] = [
    { id: "name", header: t("col.scan"), locked: true, sort: (a, b) => a.name.localeCompare(b.name), csv: (s) => s.name,
      cell: (s) => (<><Link to={`/scans/${s.id}`} className="font-medium text-slate-50 hover:underline">{s.name}</Link><div className="text-xs text-slate-500">{s.created_by}</div></>) },
    { id: "profile", header: t("col.profile"), sort: (a, b) => a.profile_name.localeCompare(b.profile_name), csv: (s) => s.profile_name, cell: (s) => <span className="text-slate-300">{s.profile_name}</span> },
    { id: "benchmark", header: "Benchmark", defaultHidden: true, sort: (a, b) => a.benchmark_id.localeCompare(b.benchmark_id), csv: (s) => s.benchmark_id, cell: (s) => <span className="font-mono text-xs text-slate-400">{s.benchmark_id}</span> },
    { id: "hosts", header: t("col.hosts"), sort: (a, b) => a.host_count - b.host_count, csv: (s) => s.host_count, cell: (s) => s.host_count },
    { id: "status", header: t("col.status"), sort: (a, b) => a.status.localeCompare(b.status), csv: (s) => s.status, cell: (s) => <StatusPill status={s.status} /> },
    { id: "ai", header: "AI", cell: (s) => { const a = aiByScan.get(s.id); return a ? <AiBadge label={`${a.counts.remediate ?? 0} ${L("to fix", "düzəlt")} · ${a.counts.review ?? 0} ${L("to review", "yoxla")}`} title={a.summary} /> : null; } },
    { id: "progress", header: t("col.progress"), sort: (a, b) => a.done_checks / Math.max(1, a.total_checks) - b.done_checks / Math.max(1, b.total_checks), csv: (s) => `${s.done_checks}/${s.total_checks}`, cell: (s) => <Progress s={s} /> },
    { id: "started", header: t("col.started"), sort: (a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""), csv: (s) => isoTime(s.started_at), cell: (s) => <span className="whitespace-nowrap text-xs text-slate-400">{s.started_at ? dateTime(s.started_at) : "-"}</span> },
    { id: "duration", header: L("Duration", "Müddət"), defaultHidden: true, csv: (s) => (s.started_at && s.finished_at ? Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000) : ""),
      cell: (s) => <span className="text-xs text-slate-400">{s.started_at && s.finished_at ? `${Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000)}s` : "-"}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("scans.title")}
        subtitle={t("scans.subtitle")}
        action={canOperate && <button onClick={() => setCreating(true)} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500">{t("scans.new")}</button>}
      />
      {error && <p className="text-red-400">{t("scans.loadError")}: {(error as Error).message}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        storageKey="scans"
        exportName="scans"
        loading={isLoading}
        initialSort={{ id: "started", dir: "desc" }}
        onRowClick={(s) => navigate(`/scans/${s.id}`)}
        emptyTitle={data.length === 0 ? t("scans.none") : t("search.none")}
        emptyHint={data.length === 0 ? L("Start a scan to measure compliance.", "Uyğunluğu ölçmək üçün yoxlama başladın.") : L("Try another filter or search.", "Başqa süzgəc və ya axtarış sınayın.")}
        toolbar={
          <>
            <Chips<Filter> label="scan status" value={filter} onChange={setFilter} options={[
              { id: "all", label: L("All", "Hamısı"), count: counts.all },
              { id: "active", label: L("Running", "İcrada"), count: counts.active },
              { id: "completed", label: L("Completed", "Tamamlanıb"), count: counts.completed },
              { id: "failed", label: L("Failed", "Uğursuz"), count: counts.failed },
            ]} />
            <input type="search" className={searchCls} placeholder={t("search.scans")} value={q} onChange={(e) => setQ(e.target.value)} />
          </>
        }
        mobileCard={(s) => (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-start justify-between gap-2"><span className="font-medium text-slate-50">{s.name}</span><StatusPill status={s.status} /></div>
            <div className="mt-1 text-xs text-slate-500">{s.profile_name} · {s.host_count} {t("col.hosts")}</div>
            <div className="mt-3"><Progress s={s} /></div>
          </div>
        )}
      />
      {creating && <NewScanModal onClose={() => setCreating(false)} onCreated={(scan: ScanDetail) => { setCreating(false); navigate(`/scans/${scan.id}`); }} />}
    </div>
  );
}
