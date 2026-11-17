import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { aiApi } from "../settingsApi";
import { useI18n } from "../i18n";

interface Msg { role: "user" | "assistant"; content: string }

/** Floating support chat. Needs an AI provider (Settings, AI providers); hidden otherwise. History lives in memory only. */
export default function ChatWidget() {
  const { lang } = useI18n();
  const az = lang === "az";
  const { pathname } = useLocation();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open]);

  if (!status.data?.chat_enabled) return null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const { reply } = await aiApi.chat(next, lang, pathname);
      setMsgs([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : az ? "Cavab alınmadı" : "Could not get a reply");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <div role="dialog" aria-label={az ? "Dəstək söhbəti" : "Support chat"} className="flex h-[28rem] max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-slate-50">Wardy</div>
              <div className="text-xs text-slate-400">{az ? "Wearden dəstək" : "Wearden support"}</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label={az ? "Bağla" : "Close"} className="text-slate-500 hover:text-slate-200">x</button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm" aria-live="polite">
            <p className="max-w-[85%] rounded-lg bg-slate-800 px-3 py-2 text-slate-200">
              {az ? "Salam! Mən Wardy. Wearden ilə bağlı nə lazımdırsa, soruş." : "Hi! I'm Wardy. Ask me anything about using Wearden."}
            </p>
            {msgs.map((m, i) => (
              <p key={i} className={`max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 ${m.role === "user" ? "ml-auto bg-cyan-900/60 text-cyan-50" : "bg-slate-800 text-slate-200"}`}>{m.content}</p>
            ))}
            {busy && <p className="w-fit rounded-lg bg-slate-800 px-3 py-2 text-slate-400">…</p>}
            {error && <p className="text-xs text-red-300">{error}</p>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-slate-800 p-3">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={az ? "Mesajınız…" : "Your message…"} aria-label={az ? "Mesaj" : "Message"} className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-600" />
            <button disabled={busy || !text.trim()} className="rounded bg-cyan-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-40">{az ? "Göndər" : "Send"}</button>
          </form>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-label={az ? "Dəstək söhbəti" : "Support chat"} aria-expanded={open} className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-700 text-white shadow-lg hover:bg-cyan-600">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
      </button>
    </div>
  );
}
