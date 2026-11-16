import { ReactNode } from "react";

/** Shared layout pieces so every page has the same rhythm: title, one primary action, filters, content. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A helpful empty state: say what is missing and what to do next. */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-800 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {hint && <p className="max-w-md text-sm text-slate-500">{hint}</p>}
      {action}
    </div>
  );
}

/** Quick filters above a table: instant, one click, one selected at a time. */
export function Chips<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            value === o.id ? "border-slate-100 bg-slate-100 text-slate-950" : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-100"
          }`}
        >
          {o.label}
          {o.count !== undefined && <span className={`ml-1.5 ${value === o.id ? "text-slate-600" : "text-slate-600"}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Table shell: sticky header, hover rows, horizontal scroll on small screens. */
export const tableWrap = "overflow-x-auto rounded-xl border border-slate-800 bg-slate-950";
export const theadCls = "sticky top-0 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500";
export const searchCls = "w-full max-w-sm rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm outline-none placeholder:text-slate-600 focus:border-slate-500";

/** Long identifiers are shortened; the full value stays in the tooltip. */
export function ShortId({ value, keep = 8 }: { value: string | null | undefined; keep?: number }) {
  if (!value) return <span className="text-slate-600">-</span>;
  const long = /^[a-f0-9]{16,}$/i.test(value);
  return <span title={value} className="font-mono text-xs">{long ? `${value.slice(0, keep)}...` : value}</span>;
}

export function relativeTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.max(0, s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
