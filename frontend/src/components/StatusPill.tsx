const STYLES: Record<string, string> = {
  pass: "bg-emerald-900/60 text-emerald-200",
  fail: "bg-red-900/70 text-red-200",
  error: "bg-amber-900/60 text-amber-200",
  not_applicable: "bg-slate-800 text-slate-300",
  queued: "bg-slate-800 text-slate-300",
  running: "bg-cyan-900/70 text-cyan-200",
  cancel_requested: "bg-amber-900/60 text-amber-200",
  completed: "bg-emerald-900/60 text-emerald-200",
  cancelled: "bg-slate-800 text-slate-300",
  failed: "bg-red-900/70 text-red-200",
  unreachable: "bg-red-900/70 text-red-200",
  pending: "bg-slate-800 text-slate-300",
};

const LABELS: Record<string, string> = {
  pass: "pass",
  fail: "fail",
  error: "error",
  not_applicable: "n/a",
};

export default function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs ${STYLES[status] ?? STYLES.pending}`}>
      {LABELS[status] ?? status.replace("_", " ")}
    </span>
  );
}
