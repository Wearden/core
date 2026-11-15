import { useQuery } from "@tanstack/react-query";
import { benchmarksApi } from "../benchmarksApi";
import { useI18n } from "../i18n";

/** Plain-language details of one benchmark control: what it checks, why it matters, and how it is fixed. */
export default function ControlInfo({ benchmarkId, controlId }: { benchmarkId: string; controlId: string }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["control", benchmarkId, controlId],
    queryFn: () => benchmarksApi.control(benchmarkId, controlId),
    staleTime: Infinity,
    retry: false,
  });

  if (q.isLoading) return <p className="text-slate-500">{t("common.loading")}</p>;
  if (q.error || !q.data) return <p className="text-slate-500">{t("ctl.loadFail")}</p>;
  const c = q.data;

  const block = (label: string, text: string | null | undefined) =>
    text ? (
      <div>
        <div className="font-semibold text-slate-300">{label}</div>
        <p className="mt-0.5 whitespace-pre-line text-slate-400">{text}</p>
      </div>
    ) : null;

  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-500">
        {c.category && <span>{t("ctl.category")}: <span className="text-slate-300">{c.category}</span></span>}
        {c.cis_ref && <span>{t("ctl.cis")}: <span className="text-slate-300">{c.cis_ref}</span></span>}
        {c.audit?.expected && <span>{t("ctl.secureValue")}: <span className="font-mono text-slate-300">{c.audit.expected}</span></span>}
      </div>
      {block(t("ctl.what"), c.description)}
      {block(t("ctl.why"), c.rationale)}
      {block(t("ctl.impact"), c.impact)}
      {c.remediation?.command && (
        <details>
          <summary className="cursor-pointer font-semibold text-slate-300">{t("ctl.fix")}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-slate-950 p-2 text-slate-300">{c.remediation.command}</pre>
        </details>
      )}
    </div>
  );
}
