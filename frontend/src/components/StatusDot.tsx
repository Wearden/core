import { useI18n } from "../i18n";

const COLORS: Record<string, string> = {
  online: "bg-emerald-400",
  degraded: "bg-amber-400",
  offline: "bg-red-500",
  unknown: "bg-slate-500",
};

const LABEL_KEYS: Record<string, string> = {
  online: "dot.online",
  degraded: "dot.degraded",
  offline: "dot.offline",
  unknown: "dot.unknown",
};

export default function StatusDot({ status }: { status: string }) {
  const { t } = useI18n();
  const color = COLORS[status] ?? COLORS.unknown;
  const label = t(LABEL_KEYS[status] ?? LABEL_KEYS.unknown);
  return (
    <span className="relative inline-flex h-3 w-3" title={label} aria-label={status}>
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`} />
      <span className={`relative inline-flex h-3 w-3 rounded-full ${color}`} />
    </span>
  );
}
