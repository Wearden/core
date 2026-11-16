// Monochrome pill: colour is reserved for the status dot, the label stays neutral.
const DOT: Record<string, string> = {
  pass: "bg-emerald-400",
  completed: "bg-emerald-400",
  fail: "bg-red-400",
  failed: "bg-red-400",
  unreachable: "bg-red-400",
  error: "bg-amber-400",
  cancel_requested: "bg-amber-400",
  running: "bg-slate-100 animate-pulse",
  queued: "bg-slate-500",
  pending: "bg-slate-500",
  cancelled: "bg-slate-500",
  not_applicable: "bg-slate-600",
};

const LABELS: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  error: "error",
  not_applicable: "n/a",
};

export default function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs text-slate-200">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[status] ?? DOT.pending}`} />
      {LABELS[status] ?? status.replace("_", " ")}
    </span>
  );
}
