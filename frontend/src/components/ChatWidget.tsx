import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { aiApi } from "../settingsApi";
import { useI18n } from "../i18n";

interface Msg { role: "user" | "assistant"; content: string }

/** Wardy's face: a small shield with eyes and a smile, in the app's cyan. */
function WardyAvatar({ size = 36, online = false }: { size?: number; online?: boolean }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label="Wardy">
        <defs>
          <linearGradient id="wardy-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#22d3ee" /><stop offset="1" stopColor="#0e7490" /></linearGradient>
        </defs>
        <circle cx="24" cy="24" r="24" fill="url(#wardy-g)" />
        <path d="M24 9l11 4v9c0 7-4.6 11.7-11 14-6.4-2.3-11-7-11-14v-9z" fill="#ecfeff" opacity=".95" />
        <circle cx="19.5" cy="22" r="2.2" fill="#0e7490" />
        <circle cx="28.5" cy="22" r="2.2" fill="#0e7490" />
        <path d="M19 28c1.4 2 3 2.8 5 2.8s3.6-.8 5-2.8" fill="none" stroke="#0e7490" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {online && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-emerald-400" />}
    </span>
  );
}

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

  const ask = async (content: string) => {
    content = content.trim();
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
  const send = (e: FormEvent) => { e.preventDefault(); void ask(text); };

  const suggestions = az
    ? ["Agenti necə qeydiyyata salım?", "Skan nəticəsini necə oxuyum?", "AI provayderi necə əlavə edim?"]
    : ["How do I enroll an agent?", "How do I read a scan result?", "How do I add an AI provider?"];

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <div role="dialog" aria-label={az ? "Dəstək söhbəti" : "Support chat"} className="flex h-[34rem] max-h-[75vh] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          <div className="flex items-center gap-3 border-b border-slate-800 bg-gradient-to-r from-cyan-950/70 to-slate-900 px-4 py-3">
            <WardyAvatar size={40} online />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-50">Wardy</div>
              <div className="truncate text-xs text-cyan-200/70">{az ? "Wearden dəstək · AI köməkçi" : "Wearden support · AI assistant"}</div>
            </div>
            {msgs.length > 0 && <button onClick={() => { setMsgs([]); setError(null); }} className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800">{az ? "Yeni söhbət" : "New chat"}</button>}
            <button onClick={() => setOpen(false)} aria-label={az ? "Bağla" : "Close"} className="text-slate-500 hover:text-slate-200">x</button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
            <div className="flex items-end gap-2">
              <WardyAvatar size={28} />
              <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-2 text-slate-200">
                {az ? "Salam! Mən Wardy. Wearden ilə bağlı nə lazımdırsa, soruş." : "Hi! I'm Wardy. Ask me anything about using Wearden."}
              </p>
            </div>
            {msgs.length === 0 && (
              <div className="flex flex-wrap gap-2 pl-9">
                {suggestions.map((q) => <button key={q} onClick={() => void ask(q)} className="rounded-full border border-cyan-900 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-900/40">{q}</button>)}
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <p key={i} className="ml-auto max-w-[80%] whitespace-pre-line rounded-2xl rounded-br-sm bg-cyan-700 px-3 py-2 text-white">{m.content}</p>
              ) : (
                <div key={i} className="flex items-end gap-2">
                  <WardyAvatar size={28} />
                  <p className="max-w-[80%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-2 text-slate-200">{m.content}</p>
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-end gap-2" aria-label={az ? "Wardy yazır" : "Wardy is typing"}>
                <WardyAvatar size={28} />
                <span className="flex gap-1 rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-3">
                  {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />)}
                </span>
              </div>
            )}
            {error && <p className="text-xs text-red-300">{error}</p>}
            <div ref={end} />
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-slate-800 p-3">
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={az ? "Mesajınız…" : "Your message…"} aria-label={az ? "Mesaj" : "Message"} className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-600" />
            <button disabled={busy || !text.trim()} aria-label={az ? "Göndər" : "Send"} className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-40">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>
            </button>
          </form>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-label={az ? "Dəstək söhbəti" : "Support chat"} aria-expanded={open} className="rounded-full shadow-lg ring-2 ring-cyan-500/40 transition hover:scale-105 hover:ring-cyan-400">
        <WardyAvatar size={56} online />
      </button>
    </div>
  );
}
