import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "../analyticsApi";
import { hardeningApi } from "../hardeningApi";
import { useHardeningSocket } from "../hooks/useHardeningSocket";
import { useI18n } from "../i18n";

/**
 * Right-hand panel of demo mode: the host's compliance gauge (before and after) and the live hardening log of the
 * most recent run. The remote desktop is on the left, so the audience sees the change happen on the machine.
 */
export default function DemoSide({ assetId, assetName }: { assetId: number; assetName: string }) {
  const { t } = useI18n();
  const host = useQuery({ queryKey: ["host-analytics", assetId], queryFn: () => analyticsApi.host(assetId), refetchInterval: 10_000 });
  const runs = useQuery({ queryKey: ["runs"], queryFn: hardeningApi.runs, refetchInterval: 10_000 });
  const latestRun = runs.data?.[0]?.id;
  const { connected, log } = useHardeningSocket(latestRun);

  const before = host.data?.before_after.before?.score ?? null;
  const after = host.data?.before_after.after?.score ?? null;
  const fmt = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)}%`);

  return (
    <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto border-l border-slate-800 bg-slate-900 p-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">{t("demo.label")} · {assetName}</div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-center">
          <div className="rounded-lg bg-slate-950 p-3">
            <div className="text-xs text-slate-400">{t("ha.before")}</div>
            <div className="text-2xl font-semibold text-red-300">{fmt(before)}</div>
          </div>
          <div className="rounded-lg bg-slate-950 p-3">
            <div className="text-xs text-slate-400">{t("ha.after")}</div>
            <div className="text-2xl font-semibold text-emerald-300">{fmt(after)}</div>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">{t("demo.liveLog")}</span>
          <span className={connected ? "text-emerald-400" : "text-slate-500"}>{latestRun ? (connected ? t("scan.live") : t("demo.waiting")) : t("demo.noRun")}</span>
        </div>
        <ol className="min-h-40 flex-1 space-y-1 overflow-y-auto rounded-lg bg-slate-950 p-2 font-mono text-xs text-slate-300">
          {log.length === 0 && <li className="text-slate-500">{t("demo.applyHint")}</li>}
          {log.map((l) => (
            <li key={l.key}>{l.text}</li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
