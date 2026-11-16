import { Component, ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/** Non-blocking toasts and an accessible confirm dialog, replacing window.confirm and silent failures. */
type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Feedback {
  toast: (text: string, kind?: ToastKind) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<Feedback | undefined>(undefined);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const next = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = next.current++;
    setToasts((list) => [...list.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "error" ? 8000 : 4500);
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...options, resolve })), []);

  const close = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };

  useEffect(() => {
    if (!dialog) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const dot = { success: "bg-emerald-400", error: "bg-red-400", info: "bg-slate-300" } as const;
  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,24rem)] flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-100 shadow-xl">
            <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[t.kind]}`} />
            <span className="flex-1">{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))} className="text-slate-500 hover:text-slate-200">x</button>
          </div>
        ))}
      </div>
      {dialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="w-full max-w-sm space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
            <h3 id="confirm-title" className="text-base font-semibold text-slate-50">{dialog.title}</h3>
            {dialog.message && <p className="text-sm text-slate-400">{dialog.message}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button autoFocus={!dialog.danger} onClick={() => close(false)} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800">{dialog.cancelLabel ?? "Cancel"}</button>
              <button autoFocus={dialog.danger} onClick={() => close(true)} className={`rounded-md px-3 py-2 text-sm font-medium ${dialog.danger ? "bg-red-400 text-slate-950 hover:bg-red-300" : "bg-cyan-600 hover:bg-cyan-500"}`}>{dialog.confirmLabel ?? "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be used inside FeedbackProvider");
  return ctx;
}

/** Placeholder block while data loads; reserves space so the layout does not jump. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-slate-800/70 ${className}`} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
}

/** A render error in one page must not blank the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto mt-24 max-w-md space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
        <h2 className="text-lg font-semibold text-slate-50">Something went wrong</h2>
        <p className="text-sm text-slate-400">This view failed to render. Your data is safe. Reload the page to continue.</p>
        <button onClick={() => window.location.reload()} className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500">Reload</button>
      </div>
    );
  }
}
