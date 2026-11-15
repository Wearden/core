import { useState } from "react";
import { Link } from "react-router-dom";
import SearchBox, { matchesSearch } from "../components/SearchBox";
import { useQuery } from "@tanstack/react-query";
import { hardeningApi, shortId } from "../hardeningApi";
import StatusPill from "../components/StatusPill";
import { useI18n } from "../i18n";

/** Rollback processes only. Hardening runs are listed in the Hardening menu, where a rollback is started. */
export default function Rollback() {
  const { t } = useI18n();
  const rollbacks = useQuery({ queryKey: ["rollbacks"], queryFn: hardeningApi.rollbacks, refetchInterval: 5_000 });
  const all = rollbacks.data ?? [];
  const [search, setSearch] = useState("");
  // Finds a rollback by its own name or ID, or by the name or ID of the hardening run it undid.
  const rows = all.filter((r) =>
    matchesSearch(search, [r.name, shortId("R", r.id), r.run_name, shortId("H", r.run_id), r.created_by, r.status]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("rb.title")}</h1>
        <p className="text-sm text-slate-400">{t("rb.subtitle2")}</p>
        <p className="mt-1 text-sm text-slate-500">
          {t("rb.howTo")} <Link to="/hardening" className="text-cyan-300 hover:underline">{t("rb.openHardening")}</Link>
        </p>
      </div>
      {rollbacks.error && <p className="text-red-400">{t("rb.loadFail")}</p>}
      {!rollbacks.isLoading && !rollbacks.error && all.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">{t("rb.noProcesses")}</div>
      )}
      {all.length > 0 && (
        <SearchBox value={search} onChange={setSearch} placeholder={t("search.rollbacks")} shown={rows.length} total={all.length} />
      )}
      {all.length > 0 && rows.length === 0 && <p className="text-sm text-slate-400">{t("search.none")}</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("col.id")}</th>
                <th className="px-4 py-3">{t("rb.process")}</th>
                <th className="px-4 py-3">{t("rb.ofRun")}</th>
                <th className="px-4 py-3">{t("col.status")}</th>
                <th className="px-4 py-3">{t("rb.result")}</th>
                <th className="px-4 py-3">{t("rb.startedBy")}</th>
                <th className="px-4 py-3">{t("col.started")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {rows.map((r) => {
                const waiting = Math.max(0, r.total - r.reverted - r.failed);
                return (
                  <tr key={r.id} className="align-top hover:bg-slate-900/60">
                    <td className="px-4 py-3 font-mono text-xs text-slate-400">{shortId("R", r.id)}</td>
                    <td className="px-4 py-3">
                      <Link to={`/hardening/${r.run_id}`} className="font-medium text-cyan-300 hover:underline">{r.name}</Link>
                      {r.legacy && <div className="text-xs text-slate-500">{t("rb.legacy")}</div>}
                      {r.message && <div className="text-xs text-red-300">{r.message}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-mono text-slate-400">{shortId("H", r.run_id)}</div>
                      <div className="text-slate-300">{r.run_name || "-"}</div>
                    </td>
                    <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span className="text-emerald-300">{r.reverted} {t("rb.reverted")}</span>
                        {r.failed > 0 && <span className="text-red-300">{r.failed} {t("rb.failed")}</span>}
                        {waiting > 0 && <span className="text-slate-400">{waiting} {t("rb.waiting")}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">{r.total} {t("hr.changes")}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-300">{r.created_by ?? "-"}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{new Date(r.started_at ?? r.created_at).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
