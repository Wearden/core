import { ReactNode } from "react";
import { ApiError } from "../api";

export const field = "w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm outline-none placeholder:text-slate-500 focus:border-slate-500";
export const btn = "inline-flex whitespace-nowrap h-9 items-center justify-center rounded-md border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-900 disabled:opacity-40";
export const btnSmall = "inline-flex whitespace-nowrap h-8 items-center justify-center rounded-md border border-slate-700 px-2.5 text-xs text-slate-200 hover:bg-slate-900 disabled:opacity-40";
export const btnPrimary = "inline-flex whitespace-nowrap h-9 items-center justify-center rounded-md bg-cyan-600 px-3 text-sm font-medium hover:bg-cyan-500 disabled:opacity-40";
export const btnDanger = "inline-flex whitespace-nowrap h-8 items-center justify-center rounded-md border border-red-900 px-2.5 text-xs text-red-400 hover:bg-red-950/50 disabled:opacity-40";

export function Card({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-slate-100">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function errText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : "Request failed";
}

/** Centered dialog used by the add and edit forms. Escape and the backdrop close it. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className={`max-h-[90vh] w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl ${wide ? "max-w-2xl" : "max-w-lg"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-50">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Labeled({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
