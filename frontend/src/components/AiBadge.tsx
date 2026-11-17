/** Marks anything an AI model produced, so it is never mistaken for a scan result. Violet stays distinct in both themes. */
export default function AiBadge({ label = "AI", title }: { label?: string; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-semibold text-violet-200">
      <span aria-hidden="true">✦</span>
      {label}
    </span>
  );
}
