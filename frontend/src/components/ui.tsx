import { ReactNode } from "react";
import RubberSegment from "./RubberSegment";

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

// RubberSegment colours come from the theme palette, so the black and the white themes both work.
const SEG_COLORS = { trackColor: "rgb(var(--slate-900))", thumbColor: "rgb(var(--slate-100))", textColor: "rgb(var(--slate-400))", activeTextColor: "rgb(var(--slate-950))" };

/** Segmented control (React Bits RubberSegment): one choice at a time; the thumb stretches across and squashes into place. */
export function Segment<T extends string>({ options, value, onChange, label, size = "sm", equal = false }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; size?: "sm" | "md" | "lg"; equal?: boolean }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <RubberSegment {...SEG_COLORS} items={options.map((o) => ({ value: o.id, label: o.label }))} value={value} onChange={(v) => onChange(v as T)} aria-label={label} size={size} equalSlots={equal} />
    </div>
  );
}

/** Quick filters above a table: instant, one click, one selected at a time. */
export function Chips<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <Segment
      label={label}
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ id: o.id, label: o.count === undefined ? o.label : <>{o.label}<span className="ml-1.5 opacity-60">{o.count}</span></> }))}
    />
  );
}

/** Table shell: sticky header, hover rows, horizontal scroll on small screens. */
export const tableWrap = "overflow-x-auto rounded-xl border border-slate-800 bg-slate-950";
export const theadCls = "sticky top-0 bg-slate-900/80 text-xs uppercase tracking-wide text-slate-500";
export const searchCls = "w-full max-w-sm rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm outline-none placeholder:text-slate-500 focus:border-slate-500";

/** Long identifiers are shortened; the full value stays in the tooltip. */
export function ShortId({ value, keep = 8 }: { value: string | null | undefined; keep?: number }) {
  if (!value) return <span className="text-slate-500">-</span>;
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
