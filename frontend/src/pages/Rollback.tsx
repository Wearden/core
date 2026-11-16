import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { hardeningApi, RollbackProcess, shortId } from "../hardeningApi";
import StatusPill from "../components/StatusPill";
import DataTable, { Column } from "../components/DataTable";
import { Chips, PageHeader, searchCls } from "../components/ui";
import { useI18n } from "../i18n";

type Filter = "all" | "active" | "completed" | "failed";

/** Rollback processes only. Hardening runs are listed in the Hardening menu, where a rollback is started. */
export default function Rollback() {
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const rollbacks = useQuery({ queryKey: ["rollbacks"], queryFn: hardeningApi.rollbacks, refetchInterval: 5_000 });
  const all = rollbacks.data ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const isActive = (r: RollbackProcess) => ["queued", "running", "rollback_queued"].includes(r.status);
  const isFailed = (r: RollbackProcess) => r.failed > 0 || r.status.includes("fail");

  // Finds a rollback by its own name or ID, or by the name or ID of the hardening run it undid.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      const inFilter = filter === "all" || (filter === "active" ? isActive(r) : filter === "failed" ? isFailed(r) : !isActive(r) && !isFailed(r));
      return inFilter && (!needle || [r.name, shortId("R", r.id), r.run_name, shortId("H", r.run_id), r.created_by ?? "", r.status].join(" ").toLowerCase().includes(needle));
    });
  }, [all, filter, q]);

  const columns: Column<RollbackProcess>[] = [
    { id: "id", header: t("col.id"), defaultHidden: true, csv: (r) => shortId("R", r.id), cell: (r) => <span className="font-mono text-xs text-slate-400">{shortId("R", r.id)}</span> },
    {
      id: "name", header: t("rb.process"), locked: true, sort: (a, b) => a.name.localeCompare(b.name), csv: (r) => r.name,
      cell: (r) => (
        <>
          <Link to={`/hardening/${r.run_id}`} className="font-medium text-slate-50 hover:underline">{r.name}</Link>
          {r.legacy && <div className="text-xs text-slate-500">{t("rb.legacy")}</div>}
          {r.message && <div className="text-xs text-red-300">{r.message}</div>}
        </>
      ),
    },
    {
      id: "run", header: t("rb.ofRun"), sort: (a, b) => a.run_name.localeCompare(b.run_name), csv: (r) => r.run_name,
      cell: (r) => (
        <div className="text-xs">
          <div className="font-mono text-slate-400">{shortId("H", r.run_id)}</div>
          <div className="text-slate-300">{r.run_name || "-"}</div>
        </div>
      ),
    },
    { id: "status", header: t("col.status"), sort: (a, b) => a.status.localeCompare(b.status), csv: (r) => r.status, cell: (r) => <StatusPill status={r.status} /> },
    {
      id: "result", header: t("rb.result"), csv: (r) => `${r.reverted}/${r.total}`,
      cell: (r) => {
        const waiting = Math.max(0, r.total - r.reverted - r.failed);
        return (
          <>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="text-emerald-300">{r.reverted} {t("rb.reverted")}</span>
              {r.failed > 0 && <span className="text-red-300">{r.failed} {t("rb.failed")}</span>}
              {waiting > 0 && <span className="text-slate-400">{waiting} {t("rb.waiting")}</span>}
            </div>
            <div className="mt-0.5 text-xs text-slate-500">{r.total} {t("hr.changes")}</div>
          </>
        );
      },
    },
    { id: "by", header: t("rb.startedBy"), sort: (a, b) => (a.created_by ?? "").localeCompare(b.created_by ?? ""), csv: (r) => r.created_by ?? "", cell: (r) => <span className="text-xs text-slate-300">{r.created_by ?? "-"}</span> },
    {
      id: "started", header: t("col.started"), sort: (a, b) => (a.started_at ?? a.created_at).localeCompare(b.started_at ?? b.created_at), csv: (r) => r.started_at ?? r.created_at,
      cell: (r) => <span className="whitespace-nowrap text-xs text-slate-400">{new Date(r.started_at ?? r.created_at).toLocaleString()}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("rb.title")}
        subtitle={`${t("rb.subtitle2")} ${t("rb.howTo")}`}
        action={<Link to="/hardening" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-900">{t("rb.openHardening")}</Link>}
      />
      {rollbacks.error && <p className="text-red-400">{t("rb.loadFail")}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="rollbacks"
        exportName="rollbacks"
        loading={rollbacks.isLoading}
        initialSort={{ id: "started", dir: "desc" }}
        emptyTitle={all.length === 0 ? t("rb.noProcesses") : t("search.none")}
        emptyHint={all.length === 0 ? L("Rollbacks appear here after you undo changes of a hardening run.", "Geri qaytarmalar hardening işinin dəyişiklikləri geri alınanda burada görünür.") : L("Try another filter or search.", "Başqa süzgəc və ya axtarış sınayın.")}
        toolbar={
          <>
            <Chips<Filter>
              label="rollback status"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: L("All", "Hamısı"), count: all.length },
                { id: "active", label: L("Running", "İcrada"), count: all.filter(isActive).length },
                { id: "completed", label: L("Completed", "Tamamlanıb"), count: all.filter((r) => !isActive(r) && !isFailed(r)).length },
                { id: "failed", label: L("Failed", "Uğursuz"), count: all.filter(isFailed).length },
              ]}
            />
            <input type="search" className={searchCls} placeholder={t("search.rollbacks")} value={q} onChange={(e) => setQ(e.target.value)} />
          </>
        }
        mobileCard={(r) => (
          <div className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-slate-50">{r.name}</span>
              <StatusPill status={r.status} />
            </div>
            <div className="mt-1 text-xs text-slate-500">{r.run_name} · {r.reverted}/{r.total} {t("rb.reverted")}</div>
          </div>
        )}
      />
    </div>
  );
}
