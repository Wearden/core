import { useQuery } from "@tanstack/react-query";
import { scansApi } from "../scansApi";
import { useI18n } from "../i18n";

/**
 * Selects controls from an earlier scan by result: failed, error, or both.
 * Only controls that exist in the chosen benchmark are selected.
 */
export default function ScanResultPicker({ scanId, known, onSelect }: { scanId: string; known: Set<string>; onSelect: (ids: string[]) => void }) {
  const { lang } = useI18n();
  const L = (en: string, a: string) => (lang === "az" ? a : en);
  const results = useQuery({ queryKey: ["scan-results", scanId], queryFn: () => scansApi.results(scanId), enabled: !!scanId });
  if (!scanId) return null;
  const pick = (statuses: string[]) => Array.from(new Set((results.data ?? []).filter((r) => statuses.includes(r.status) && known.has(r.control_id)).map((r) => r.control_id)));
  const failed = pick(["fail"]);
  const errored = pick(["error"]);
  const both = pick(["fail", "error"]);
  const btn = "rounded-md border px-3 py-1 text-xs disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950 p-2 text-xs">
      <span className="text-slate-400">{L("Select from scan results:", "Skan nəticələrindən seç:")}</span>
      {results.isLoading && <span className="text-slate-500">{L("Loading...", "Yüklənir...")}</span>}
      {results.error && <span className="text-red-300">{(results.error as Error).message}</span>}
      <button type="button" className={`${btn} border-red-900 text-red-300 hover:bg-red-950/50`} disabled={failed.length === 0} onClick={() => onSelect(failed)}>
        {L("Failed", "Uğursuz")} ({failed.length})
      </button>
      <button type="button" className={`${btn} border-amber-800 text-amber-300 hover:bg-amber-950/40`} disabled={errored.length === 0} onClick={() => onSelect(errored)}>
        {L("Error", "Xəta")} ({errored.length})
      </button>
      <button type="button" className={`${btn} border-slate-700 text-slate-200 hover:bg-slate-800`} disabled={both.length === 0} onClick={() => onSelect(both)}>
        {L("Failed and error", "Uğursuz və xəta")} ({both.length})
      </button>
    </div>
  );
}
