import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { useI18n } from "../i18n";
import { Chips, PageHeader, ShortId, relativeTime, searchCls } from "../components/ui";
import DataTable, { Column } from "../components/DataTable";

type Row = Awaited<ReturnType<typeof assetsApi.audit>>[number];

type Group = "people" | "all" | "signin" | "hardening" | "agents" | "settings";

function groupOf(action: string): Group {
  if (action.startsWith("auth.")) return "signin";
  if (action.startsWith("agent.")) return "agents";
  if (action.startsWith("hardening.") || action.startsWith("scan.")) return "hardening";
  if (action.startsWith("settings.") || action.startsWith("profile.") || action.startsWith("asset.") || action.startsWith("credential.")) return "settings";
  return "people";
}

export default function Audit() {
  const { t, lang } = useI18n();
  const L = (en: string, az: string) => (lang === "az" ? az : en);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["audit"], queryFn: () => assetsApi.audit(500), refetchInterval: 15_000 });
  const [group, setGroup] = useState<Group>("people");
  const [q, setQ] = useState("");

  // Machine events (agent reports, task results) are routine noise, so the default view shows what people did.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.filter((r) => {
      const g = groupOf(r.action);
      const inGroup = group === "all" || (group === "people" ? g !== "agents" && !r.action.startsWith("hardening.task_result") && !r.action.startsWith("scan.queued") : g === group);
      return inGroup && (!needle || `${r.action} ${r.username ?? ""} ${r.target ?? ""} ${r.detail ?? ""}`.toLowerCase().includes(needle));
    });
  }, [data, group, q]);

  const columns: Column<Row>[] = [
    { id: "time", header: t("audit.time"), sort: (x, y) => Date.parse(x.created_at) - Date.parse(y.created_at), csv: (r) => r.created_at, locked: true, cell: (r) => <span className="whitespace-nowrap text-xs text-slate-500" title={new Date(r.created_at).toLocaleString()}>{relativeTime(r.created_at)}</span> },
    { id: "user", header: t("audit.user"), sort: (x, y) => (x.username ?? "").localeCompare(y.username ?? ""), csv: (r) => r.username, cell: (r) => <span className="text-slate-300">{r.username ?? "-"}</span> },
    { id: "action", header: t("audit.action"), sort: (x, y) => x.action.localeCompare(y.action), csv: (r) => r.action, cell: (r) => <span className="font-mono text-xs text-slate-200">{r.action}</span> },
    { id: "target", header: t("audit.target"), csv: (r) => r.target, cell: (r) => <ShortId value={r.target} /> },
    { id: "result", header: t("audit.result"), sort: (x, y) => Number(x.success) - Number(y.success), csv: (r) => (r.success ? "ok" : "failed"), cell: (r) => (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${r.success ? "bg-emerald-400" : "bg-red-400"}`} />
        {r.success ? t("audit.ok") : t("dash.failed")}
      </span>
    ) },
    { id: "detail", header: t("audit.detail"), csv: (r) => r.detail, cell: (r) => <span className="block max-w-xs truncate text-xs text-slate-500" title={r.detail ?? ""}>{r.detail ?? ""}</span> },
  ];

  const count = (g: Group) => data.filter((r) => (g === "all" ? true : g === "people" ? groupOf(r.action) !== "agents" && !r.action.startsWith("hardening.task_result") && !r.action.startsWith("scan.queued") : groupOf(r.action) === g)).length;

  return (
    <div className="space-y-5">
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips
          label="filter"
          value={group}
          onChange={setGroup}
          options={[
            { id: "people", label: L("People", "Istifadəçilər"), count: count("people") },
            { id: "signin", label: L("Sign-ins", "Girişlər"), count: count("signin") },
            { id: "hardening", label: L("Hardening and scans", "Hardening və yoxlamalar"), count: count("hardening") },
            { id: "settings", label: L("Settings and assets", "Parametrlər və aktivlər"), count: count("settings") },
            { id: "agents", label: L("Agents", "Agentlər"), count: count("agents") },
            { id: "all", label: L("All", "Hamısı"), count: count("all") },
          ]}
        />
        <input type="search" className={searchCls} placeholder={L("Search action, user or target", "Əməliyyat, istifadəçi və ya hədəf üzrə axtar")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="text-red-400">{t("audit.loadError")}: {(error as Error).message}</p>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        storageKey="audit"
        exportName="wearden-audit"
        loading={isLoading}
        pageSizes={[25, 50, 100, 250]}
        initialSort={{ id: "time", dir: "desc" }}
        emptyTitle={L("No matching events", "Uyğun hadisə yoxdur")}
        emptyHint={L("Try another filter or clear the search.", "Başqa süzgəc seçin və ya axtarışı təmizləyin.")}
      />
    </div>
  );
}
