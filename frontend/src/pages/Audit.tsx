import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { useI18n } from "../i18n";
import { Chips, EmptyState, PageHeader, ShortId, relativeTime, searchCls, tableWrap, theadCls } from "../components/ui";

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
      {isLoading && <p className="text-slate-500">{t("common.loading")}</p>}
      {!isLoading && rows.length === 0 && <EmptyState title={L("No matching events", "Uyğun hadisə yoxdur")} hint={L("Try another filter or clear the search.", "Başqa süzgəc seçin və ya axtarışı təmizləyin.")} />}
      {rows.length > 0 && (
        <div className={tableWrap}>
          <table className="w-full text-left text-sm">
            <thead className={theadCls}>
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("audit.time")}</th>
                <th className="px-4 py-2.5 font-medium">{t("audit.user")}</th>
                <th className="px-4 py-2.5 font-medium">{t("audit.action")}</th>
                <th className="px-4 py-2.5 font-medium">{t("audit.target")}</th>
                <th className="px-4 py-2.5 font-medium">{t("audit.result")}</th>
                <th className="px-4 py-2.5 font-medium">{t("audit.detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-900/60">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-500" title={new Date(row.created_at).toLocaleString()}>{relativeTime(row.created_at)}</td>
                  <td className="px-4 py-2 text-slate-300">{row.username ?? "-"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-200">{row.action}</td>
                  <td className="px-4 py-2"><ShortId value={row.target} /></td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${row.success ? "bg-emerald-400" : "bg-red-400"}`} />
                      {row.success ? t("audit.ok") : t("dash.failed")}
                    </span>
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-500" title={row.detail ?? ""}>{row.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
