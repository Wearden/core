import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { scansApi, ScanDetail } from "../scansApi";
import NewScanModal from "../components/NewScanModal";
import StatusPill from "../components/StatusPill";
import SearchBox, { matchesSearch } from "../components/SearchBox";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

export default function Scans() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const canOperate = user?.role === "admin" || user?.role === "operator";
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["scans"],
    queryFn: scansApi.list,
    refetchInterval: 5_000,
  });
  const [search, setSearch] = useState("");
  const shown = data.filter((s) => matchesSearch(search, [s.name, s.profile_name, s.created_by, s.status]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t("scans.title")}</h1>
          <p className="text-sm text-slate-400">{t("scans.subtitle")}</p>
        </div>
        {canOperate && (
          <button onClick={() => setCreating(true)} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500">
            {t("scans.new")}
          </button>
        )}
      </div>

      {error && <p className="text-red-400">{t("scans.loadError")}: {(error as Error).message}</p>}
      {isLoading && <p className="text-slate-400">{t("common.loading")}</p>}
      {!isLoading && data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">{t("scans.none")}</div>
      )}

      {data.length > 0 && (
        <SearchBox value={search} onChange={setSearch} placeholder={t("search.scans")} shown={shown.length} total={data.length} />
      )}
      {data.length > 0 && shown.length === 0 && <p className="text-sm text-slate-400">{t("search.none")}</p>}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3">{t("col.scan")}</th>
                <th className="px-4 py-3">{t("col.profile")}</th>
                <th className="px-4 py-3">{t("col.hosts")}</th>
                <th className="px-4 py-3">{t("col.status")}</th>
                <th className="px-4 py-3">{t("col.progress")}</th>
                <th className="px-4 py-3">{t("col.started")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {shown.map((s) => {
                const pct = s.total_checks ? Math.round((s.done_checks / s.total_checks) * 100) : 0;
                return (
                  <tr key={s.id} className="cursor-pointer hover:bg-slate-900/60" onClick={() => navigate(`/scans/${s.id}`)}>
                    <td className="px-4 py-3">
                      <Link to={`/scans/${s.id}`} className="font-medium text-cyan-300 hover:underline" onClick={(e) => e.stopPropagation()}>
                        {s.name}
                      </Link>
                      <div className="text-xs text-slate-500">{s.created_by}</div>
                    </td>
                    <td className="px-4 py-3">{s.profile_name}</td>
                    <td className="px-4 py-3">{s.host_count}</td>
                    <td className="px-4 py-3"><StatusPill status={s.status} /></td>
                    <td className="px-4 py-3">
                      <div className="h-2 w-40 overflow-hidden rounded bg-slate-800">
                        <div className="h-full bg-cyan-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-xs text-slate-500">{s.done_checks} / {s.total_checks}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">
                      {s.started_at ? new Date(s.started_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewScanModal
          onClose={() => setCreating(false)}
          onCreated={(scan: ScanDetail) => {
            setCreating(false);
            navigate(`/scans/${scan.id}`);
          }}
        />
      )}
    </div>
  );
}
