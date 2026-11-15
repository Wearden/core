import { useQuery } from "@tanstack/react-query";
import { assetsApi } from "../assetsApi";
import { useI18n } from "../i18n";

export default function Audit() {
  const { t } = useI18n();
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["audit"],
    queryFn: () => assetsApi.audit(200),
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("audit.title")}</h1>
        <p className="text-sm text-slate-400">{t("audit.subtitle")}</p>
      </div>
      {error && <p className="text-red-400">{t("audit.loadError")}: {(error as Error).message}</p>}
      {isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
      {data.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("audit.time")}</th>
                <th className="px-4 py-3">{t("audit.user")}</th>
                <th className="px-4 py-3">{t("audit.action")}</th>
                <th className="px-4 py-3">{t("audit.target")}</th>
                <th className="px-4 py-3">{t("audit.result")}</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">{t("audit.detail")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.map((row) => (
                <tr key={row.id} className="hover:bg-slate-900/60">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2">{row.username ?? "-"}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.action}</td>
                  <td className="px-4 py-2">{row.target ?? "-"}</td>
                  <td className={`px-4 py-2 ${row.success ? "text-emerald-400" : "text-red-400"}`}>{row.success ? t("audit.ok") : t("dash.failed")}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.ip ?? "-"}</td>
                  <td className="px-4 py-2 text-xs text-slate-400">{row.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
