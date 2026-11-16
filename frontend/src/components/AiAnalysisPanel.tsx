import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiApi } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { NewHardening } from "../pages/Hardening";

const ACTION_STYLE: Record<string, string> = {
  remediate: "bg-cyan-900/60 text-cyan-200",
  review: "bg-amber-900/60 text-amber-200",
  accept: "bg-slate-800 text-slate-300",
};

/** Advisory AI decisions for a finished scan; hardening still goes through the normal reviewed plan. */
export default function AiAnalysisPanel({ scanId, benchmarkId }: { scanId: string; benchmarkId: string }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canOperate = user?.level === "admin" || user?.level === "operator";
  const [planning, setPlanning] = useState(false);
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status });
  const stored = useQuery({ queryKey: ["ai-analysis", scanId], queryFn: () => aiApi.stored(scanId), retry: false });
  const analyze = useMutation({
    mutationFn: () => aiApi.analyze(scanId, lang),
    onSuccess: (data) => queryClient.setQueryData(["ai-analysis", scanId], data),
  });
  const result = analyze.data ?? stored.data;
  const picked = (result?.decisions ?? []).filter((d) => d.action === "remediate").map((d) => d.control_id);
  return (
    <div className="space-y-3 rounded-xl border border-cyan-900 bg-cyan-950/20 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-cyan-200">{t("ai.title")}</h2>
        {canOperate && (
          <button onClick={() => analyze.mutate()} disabled={!status.data?.enabled || analyze.isPending} className="rounded-md bg-cyan-700 px-3 py-1.5 text-sm hover:bg-cyan-600 disabled:opacity-40">
            {analyze.isPending ? t("ai.running") : t("ai.analyze")}
          </button>
        )}
      </div>
      {status.data && !status.data.enabled && <p className="text-xs text-amber-300">{t("ai.noKey")}</p>}
      {analyze.error && <p className="text-xs text-red-300">{(analyze.error as Error).message}</p>}
      {result && (
        <>
          <p className="whitespace-pre-line text-sm text-slate-200">{result.summary}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="py-1 pr-3">{t("ai.priority")}</th>
                  <th className="py-1 pr-3">{t("ai.control")}</th>
                  <th className="py-1 pr-3">{t("ai.decision")}</th>
                  <th className="py-1">{t("ai.reason")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {result.decisions.map((d) => (
                  <tr key={d.control_id}>
                    <td className="py-2 pr-3">{d.priority}</td>
                    <td className="py-2 pr-3"><span className="font-mono">{d.control_id}</span> <span className="text-slate-400">{d.title}</span></td>
                    <td className="py-2 pr-3"><span className={`rounded px-2 py-0.5 ${ACTION_STYLE[d.action]}`}>{t(`ai.action.${d.action}`)}</span>{d.risky && <span className="ml-1 text-amber-300">!</span>}</td>
                    <td className="py-2 text-slate-300">{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">{t("ai.advisory")} · {result.model}</p>
          {canOperate && picked.length > 0 && (
            <button onClick={() => setPlanning(true)} className="rounded-md border border-cyan-700 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-900/40">
              {t("ai.planHardening")} ({picked.length})
            </button>
          )}
        </>
      )}
      {planning && <NewHardening onClose={() => setPlanning(false)} initialBenchmarkId={benchmarkId} initialControlIds={picked} />}
    </div>
  );
}
