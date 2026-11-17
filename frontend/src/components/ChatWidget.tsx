import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { aiApi } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import Logo from "./Logo";
import UserAvatar, { useProfile } from "./UserAvatar";
import { usePrefs } from "../prefs";

interface Msg { role: "user" | "assistant"; content: string }
/** One saved conversation with Wardy, kept in this browser per user. */
interface Convo { id: string; title: string; updated: number; msgs: Msg[] }
type Tab = "home" | "chat" | "help";

const COLOR: Record<string, string> = { red: "text-red-300", green: "text-emerald-300", yellow: "text-amber-300", cyan: "text-cyan-300", violet: "text-violet-300" };
const TOKEN = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[\[(?:red|green|yellow|cyan|violet):[^\]\n]+\]\])/g;

/** Renders **bold**, *italic*, `code` and [[colour:text]] as React elements. Nothing is injected as HTML. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i} className="font-semibold text-white">{part.slice(2, -2)}</strong>;
        if (part.startsWith("[[") && part.endsWith("]]")) {
          const [name, ...rest] = part.slice(2, -2).split(":");
          return <span key={i} className={`font-medium ${COLOR[name] ?? ""}`}>{rest.join(":")}</span>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[12px] text-cyan-200">{part.slice(1, -1)}</code>;
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
        return part;
      })}
    </>
  );
}

/** Wardy: a small black and white orb with two soft blobs that drift and change shape. Static unless `animated`. */
function WardyAvatar({ size = 36, online = false, animated = false }: { size?: number; online?: boolean; animated?: boolean }) {
  const blob = animated ? "wd-orb-anim" : "";
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} role="img" aria-label="Wardy">
      <span className="wd-orb" style={{ ["--s" as string]: size }}>
        <span className={`wd-blob wd-blob-a ${blob}`} />
        <span className={`wd-blob wd-blob-b ${blob}`} />
        <span className="wd-gloss" />
      </span>
      {online && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-black bg-emerald-400" />}
    </span>
  );
}

const ICON: Record<Tab, string> = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
};
const Chevron = () => <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-slate-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>;
const card = "w-full rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-left transition hover:border-slate-600";

// Hand-written answers: no tokens are spent until the user chooses to ask Wardy.
const ARTICLES: { q: [string, string]; a: [string, string] }[] = [
  { q: ["How do I enroll an agent?", "Agenti necə qeydiyyata salım?"], a: ["Open Assets, then Agents, then Enroll a new agent. Copy the one-line command and run it on the host. The token is single-use and scoped to one benchmark.", "Aktivlər, sonra Agentlər, sonra Yeni agent qeydiyyatı bölməsinə keçin. Bir sətirlik əmri kopyalayıb hostda işlədin. Token birdəfəlikdir və bir benchmark-a aiddir."] },
  { q: ["How do I read a scan result?", "Skan nəticəsini necə oxuyum?"], a: ["Open Scans and pick a scan. Failed controls are the ones to fix; filter by severity or status, and press Explain on a control for a plain-language reason. Errors mean the agent could not check, they are not passes.", "Skanlar bölməsində skanı açın. Uğursuz nəzarətlər düzəldilməlidir; ciddilik və ya statusa görə süzün, izah üçün nəzarətdə İzah et düyməsini basın. Xəta o deməkdir ki, agent yoxlaya bilməyib, bu keçid deyil."] },
  { q: ["How do I harden a host safely?", "Hostu necə təhlükəsiz sərtləşdirim?"], a: ["In Hardening, build a plan from a scan and review the risk and reboot notes before confirming. Agents only apply changes when started with remediation enabled. Every change can be undone from Rollback.", "Sərtləşdirmə bölməsində skandan plan qurun, təsdiqdən əvvəl risk və yenidən başlatma qeydlərinə baxın. Agentlər yalnız remediation aktiv olduqda dəyişiklik edir. Hər dəyişiklik Rollback bölməsindən geri qaytarıla bilər."] },
  { q: ["How do I add an AI provider?", "AI provayderi necə əlavə edim?"], a: ["Settings, then AI providers, then Add provider. Pick a preset or Custom OpenAI compatible, enter the model and key, press Check connection, then Save. Choose below which AI handles scan analysis and which handles this chat.", "Parametrlər, sonra AI provayderləri, sonra Provayder əlavə et. Hazır növü və ya Custom OpenAI compatible seçin, model və açarı yazın, Bağlantını yoxla, sonra Saxla basın. Aşağıda skan analizi və bu çat üçün hansı AI-ın işləyəcəyini seçin."] },
  { q: ["How do I watch a scan live?", "Skanı canlı necə izləyim?"], a: ["Open a running scan or hardening run. A Live flow bar sits at the top of the page and the window opens by itself while work is running; click any box, host or event line for details.", "İşləyən skanı və ya sərtləşdirməni açın. Səhifənin yuxarısında Canlı axın zolağı var və iş gedərkən pəncərə özü açılır; istənilən qutuya, hosta və ya hadisə sətrinə basaraq ətraflı məlumat görün."] },
  { q: ["Who can approve new users?", "Yeni istifadəçiləri kim təsdiqləyir?"], a: ["The first account that registers becomes the administrator. Later registrations wait for the administrator's approval under Settings.", "İlk qeydiyyatdan keçən hesab administrator olur. Sonrakı qeydiyyatlar Parametrlərdə administratorun təsdiqini gözləyir."] },
];

// Launcher motion: a static dashed outline, a gentle float, a drifting orb and a pop-in greeting. All of it stops for reduced-motion users.
const FX_CSS = `@keyframes wd-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes wd-morph-a{0%,100%{border-radius:60% 40% 30% 70%/60% 30% 70% 40%;transform:translate(-10%,-8%) rotate(0deg)}50%{border-radius:30% 60% 70% 40%/50% 60% 30% 60%;transform:translate(10%,8%) rotate(200deg)}}
@keyframes wd-morph-b{0%,100%{border-radius:40% 60% 60% 40%/70% 30% 70% 30%;transform:translate(12%,10%) rotate(40deg)}50%{border-radius:70% 30% 40% 60%/40% 70% 30% 60%;transform:translate(-12%,-10%) rotate(-160deg)}}
.wd-orb{position:relative;display:block;width:calc(var(--s) * 1px);height:calc(var(--s) * 1px);overflow:hidden;border-radius:9999px;background:radial-gradient(circle at 50% 55%,#27272a 0%,#0a0a0a 75%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
.wd-blob{position:absolute;left:12%;top:12%;width:76%;height:76%;filter:blur(calc(var(--s) * .07px))}
.wd-blob-a{background:radial-gradient(circle at 30% 30%,#fff 0%,#d4d4d8 45%,#71717a 100%);border-radius:60% 40% 30% 70%/60% 30% 70% 40%;opacity:.95}
.wd-blob-b{background:radial-gradient(circle at 70% 70%,#e4e4e7 0%,#52525b 70%,transparent 100%);border-radius:40% 60% 60% 40%/70% 30% 70% 30%;opacity:.7;mix-blend-mode:screen}
.wd-gloss{position:absolute;left:20%;top:12%;width:34%;height:20%;border-radius:9999px;background:rgba(255,255,255,.55);filter:blur(calc(var(--s) * .05px));transform:rotate(-30deg)}
.wd-orb-anim.wd-blob-a{animation:wd-morph-a 7s ease-in-out infinite}.wd-orb-anim.wd-blob-b{animation:wd-morph-b 9s ease-in-out infinite}
@keyframes wd-pop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
@keyframes wd-spin-in{from{transform:rotate(-90deg) scale(.5);opacity:0}to{transform:none;opacity:1}}
.wd-float{animation:wd-float 4s ease-in-out infinite}.wd-float:hover{animation-play-state:paused}
.wd-pop{animation:wd-pop .35s ease-out}.wd-spin-in{animation:wd-spin-in .25s ease-out}
@media (prefers-reduced-motion:reduce){.wd-float,.wd-orb-anim,.wd-pop,.wd-spin-in{animation:none}}`;

/** Messenger-style support window: Home, Messages (chat with Wardy) and Help. Needs an AI provider; hidden otherwise. History lives in memory only. */
export default function ChatWidget() {
  const { lang } = useI18n();
  const az = lang === "az";
  const L = (en: string, a: string) => (az ? a : en);
  const { user } = useAuth();
  const { pathname } = useLocation();
  const status = useQuery({ queryKey: ["ai-status"], queryFn: aiApi.status, staleTime: 60_000 });
  const prefs = usePrefs();
  const profile = useProfile();
  const ready = useQuery({ queryKey: ["chat-ready"], queryFn: api.ready, refetchInterval: 30_000, enabled: status.data?.chat_enabled === true });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const storeKey = user ? `wearden.chat.${user.id}` : "";
  const [convos, setConvos] = useState<Convo[]>([]);
  // null shows the conversation list, "new" an empty conversation, otherwise that conversation.
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (!storeKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "[]");
      setConvos(Array.isArray(saved) ? saved : []);
    } catch {
      setConvos([]);
    }
  }, [storeKey]);
  const persist = (next: Convo[]) => {
    try {
      if (storeKey) localStorage.setItem(storeKey, JSON.stringify(next));
    } catch {
      /* history is a convenience; without storage it lasts until reload */
    }
  };
  const convo = convos.find((c) => c.id === current);
  const msgs = convo?.msgs ?? [];
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [openArticle, setOpenArticle] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // Clicking anywhere outside the window or pressing Escape closes it.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  const [hint, setHint] = useState(false);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [convo?.msgs.length, current, busy, open, tab]);
  // One short greeting per browser session.
  useEffect(() => {
    if (status.data?.chat_enabled !== true) return;
    try {
      if (sessionStorage.getItem("wardy-hint") === "1") return;
      sessionStorage.setItem("wardy-hint", "1");
    } catch { /* storage may be blocked; show the greeting anyway */ }
    const on = window.setTimeout(() => setHint(true), 2500);
    const off = window.setTimeout(() => setHint(false), 11000);
    return () => { window.clearTimeout(on); window.clearTimeout(off); };
  }, [status.data?.chat_enabled]);

  if (!status.data?.chat_enabled || !prefs.assistant) return null;

  const ask = async (content: string) => {
    content = content.trim();
    if (!content || busy) return;
    const id = current && current !== "new" ? current : Date.now().toString(36);
    const base = convos.find((c) => c.id === id)?.msgs ?? [];
    const next: Msg[] = [...base, { role: "user", content }];
    const save = (m: Msg[]) =>
      setConvos((cs) => {
        const title = cs.find((c) => c.id === id)?.title ?? content.slice(0, 60);
        const updated = [{ id, title, updated: Date.now(), msgs: m.slice(-40) }, ...cs.filter((c) => c.id !== id)].slice(0, 20);
        persist(updated);
        return updated;
      });
    setCurrent(id);
    setTab("chat");
    save(next);
    setText("");
    setBusy(true);
    setError(null);
    try {
      const { reply } = await aiApi.chat(next, lang, pathname);
      save([...next, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : L("Could not get a reply", "Cavab alınmadı"));
    } finally {
      setBusy(false);
    }
  };
  const send = (e: FormEvent) => { e.preventDefault(); void ask(text); };

  const healthy = ready.data?.status === "ok" && ready.data?.database === "ok";
  const checking = ready.isLoading;
  const statusTone = checking ? "bg-slate-700 text-slate-200" : healthy ? "bg-emerald-600 text-white" : "bg-amber-600 text-white";
  const updated = ready.dataUpdatedAt ? new Date(ready.dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const articles = ARTICLES.map((a, i) => ({ ...a, i })).filter((a) => `${a.q[0]} ${a.q[1]}`.toLowerCase().includes(search.trim().toLowerCase()));

  const closeBtn = (
    <button onClick={() => setOpen(false)} aria-label={L("Close", "Bağla")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-white">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );
  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? L("now", "indi") : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };
  const list: ReactNode = (
    <>
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <span className="text-sm font-semibold text-slate-50">{L("Messages", "Mesajlar")}</span>
        {closeBtn}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-3">
        <button onClick={() => { setCurrent("new"); setError(null); }} className="mb-2 flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-left text-sm font-semibold text-slate-50 transition hover:border-slate-500">
          {L("New conversation", "Yeni söhbət")}
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        {convos.length === 0 && <p className="px-1 py-8 text-center text-xs text-slate-500">{L("No conversations yet. Start one above.", "Hələ söhbət yoxdur. Yuxarıdan başlayın.")}</p>}
        {convos.map((c) => {
          const last = c.msgs[c.msgs.length - 1];
          return (
            <button key={c.id} onClick={() => { setCurrent(c.id); setError(null); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-slate-800/60">
              <WardyAvatar size={32} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{c.title}</span>
                  <span className="shrink-0 text-[11px] text-slate-500">{ago(c.updated)}</span>
                </span>
                <span className="block truncate text-xs text-slate-400">{last ? (last.role === "user" ? L("You: ", "Siz: ") : "") + last.content.replace(/[*`[\]]/g, "") : ""}</span>
              </span>
            </button>
          );
        })}
        {convos.length > 0 && <button onClick={() => { setConvos([]); persist([]); }} className="mx-auto block pt-3 text-[11px] text-slate-500 hover:text-red-300">{L("Clear history", "Tarixçəni sil")}</button>}
      </div>
    </>
  );

  const home: ReactNode = (
    <div className="flex-1 overflow-y-auto">
      <div className="bg-gradient-to-b from-cyan-950/70 via-slate-900 to-slate-900 px-5 pb-6 pt-5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-cyan-300"><Logo className="h-6 w-auto" /><span className="text-lg font-bold tracking-wide text-slate-50">WEARDEN</span></span>
          <span className="flex items-center gap-2"><WardyAvatar size={36} online animated />{closeBtn}</span>
        </div>
        <div className="mt-10">
          <p className="text-2xl font-bold text-slate-400">{L("Hi", "Salam")} {profile.data?.display_name || user?.username} <span aria-hidden="true">👋</span></p>
          <p className="text-2xl font-bold text-slate-50">{L("How can we help?", "Sizə necə kömək edək?")}</p>
        </div>
      </div>
      <div className="space-y-3 px-4 pb-4">
        <button onClick={() => { setCurrent("new"); setTab("chat"); }} className={`${card} flex items-center justify-between gap-3`}>
          <span><span className="block text-sm font-semibold text-slate-50">{L("Send us a message", "Bizə mesaj yazın")}</span><span className="block text-xs text-slate-400">{L("Wardy usually replies in seconds", "Wardy adətən saniyələr içində cavab verir")}</span></span>
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-cyan-300" fill="currentColor"><path d="M3 20l18-8L3 4v6l12 2-12 2z" /></svg>
        </button>
        <div className={`${card} flex items-center gap-3`} role="status">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${statusTone}`}>{checking ? "…" : healthy ? "✓" : "!"}</span>
          <span>
            <span className="block text-sm font-semibold text-slate-50">{checking ? L("Checking status…", "Status yoxlanır…") : healthy ? L("Status: all systems operational", "Status: bütün sistemlər işləyir") : L("Status: a service needs attention", "Status: bir xidmət diqqət tələb edir")}</span>
            {updated && <span className="block text-xs text-slate-400">{L("Updated", "Yenilənib")} {updated}</span>}
          </span>
        </div>
        <div className={card}>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setOpenArticle(null); }} placeholder={L("Search for help", "Yardım axtarın")} aria-label={L("Search for help", "Yardım axtarın")} className="mb-2 w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-400 focus:ring-1 focus:ring-cyan-600" />
          {articles.slice(0, 4).map((a) => (
            <button key={a.i} onClick={() => { setTab("help"); setSearch(""); setOpenArticle(a.i); }} className="flex w-full items-center justify-between gap-3 border-t border-slate-800 py-2.5 text-left text-sm text-slate-200 first:border-0 hover:text-white">{a.q[az ? 1 : 0]}<Chevron /></button>
          ))}
          {articles.length === 0 && <p className="py-2 text-xs text-slate-500">{L("Nothing found. Ask Wardy instead.", "Heç nə tapılmadı. Əvəzinə Wardy-dən soruşun.")}</p>}
        </div>
      </div>
    </div>
  );

  const help: ReactNode = (
    <>
    <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
      <span className="text-sm font-semibold text-slate-50">{L("Help", "Kömək")}</span>
      {closeBtn}
    </div>
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      <input value={search} onChange={(e) => { setSearch(e.target.value); setOpenArticle(null); }} placeholder={L("Search for help", "Yardım axtarın")} aria-label={L("Search for help", "Yardım axtarın")} className="w-full rounded-lg bg-slate-800 px-3 py-2 pr-8 text-sm text-slate-100 outline-none placeholder:text-slate-400 focus:ring-1 focus:ring-cyan-600" />
      {articles.map((a) => (
        <div key={a.i} className="rounded-xl border border-slate-800 bg-slate-950/70">
          <button onClick={() => setOpenArticle(openArticle === a.i ? null : a.i)} aria-expanded={openArticle === a.i} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-slate-100">{a.q[az ? 1 : 0]}<Chevron /></button>
          {openArticle === a.i && (
            <div className="space-y-3 border-t border-slate-800 px-4 py-3 text-sm text-slate-300">
              <p>{a.a[az ? 1 : 0]}</p>
              <button onClick={() => void ask(a.q[az ? 1 : 0])} className="rounded-full border border-cyan-900 bg-cyan-950/30 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-900/40">{L("Ask Wardy about this", "Bu barədə Wardy-dən soruş")}</button>
            </div>
          )}
        </div>
      ))}
      {articles.length === 0 && <p className="text-sm text-slate-500">{L("Nothing found. Ask Wardy instead.", "Heç nə tapılmadı. Əvəzinə Wardy-dən soruşun.")}</p>}
    </div>
    </>
  );

  const chat: ReactNode = (
    <>
      <div className="flex items-center gap-2 border-b border-slate-800 bg-gradient-to-r from-cyan-950/70 to-slate-900 px-3 py-3">
        <button onClick={() => setCurrent(null)} aria-label={L("All conversations", "Bütün söhbətlər")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-800 hover:text-white">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <WardyAvatar size={36} online animated />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-50">Wardy</div>
          <div className="truncate text-xs text-cyan-200/70">{L("Wearden support · AI assistant", "Wearden dəstək · AI köməkçi")}</div>
        </div>
        {msgs.length > 0 && <button onClick={() => { setCurrent("new"); setError(null); }} className="h-8 shrink-0 rounded-full border border-slate-700 px-3 text-[11px] text-slate-300 transition hover:bg-slate-800">{L("New chat", "Yeni söhbət")}</button>}
        {closeBtn}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm" aria-live="polite">
        <div className="flex items-end gap-2">
          <WardyAvatar size={28} />
          <p className="max-w-[80%] rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-2 text-slate-200">{L("Hi! I'm Wardy. Ask me anything about using Wearden.", "Salam! Mən Wardy. Wearden ilə bağlı nə lazımdırsa, soruş.")}</p>
        </div>
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex items-end justify-end gap-2">
              <p className="w-fit max-w-[80%] whitespace-pre-line break-words rounded-2xl rounded-br-sm bg-cyan-700 px-3 py-2 text-white">{m.content}</p>
              <UserAvatar size={28} />
            </div>
          ) : (
            <div key={i} className="flex items-end gap-2">
              <WardyAvatar size={28} />
              <p className="max-w-[80%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-slate-800 px-3 py-2 text-slate-200"><Rich text={m.content} /></p>
            </div>
          ),
        )}
        {busy && (
          <div className="flex items-end gap-2" aria-label={L("Wardy is typing", "Wardy yazır")}>
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
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder={L("Your message…", "Mesajınız…")} aria-label={L("Message", "Mesaj")} className="min-w-0 flex-1 rounded-full border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-slate-100 outline-none focus:border-cyan-600" />
        <button disabled={busy || !text.trim()} aria-label={L("Send", "Göndər")} className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-700 text-white hover:bg-cyan-600 disabled:opacity-40">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>
        </button>
      </form>
    </>
  );

  const tabs: [Tab, string][] = [["home", L("Home", "Əsas")], ["chat", L("Messages", "Mesajlar")], ["help", L("Help", "Kömək")]];
  return (
    <div ref={root} className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      <style>{FX_CSS}</style>
      {open && (
        <div role="dialog" aria-label={L("Support", "Dəstək")} className="relative flex h-[36rem] max-h-[80vh] w-[24rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
          {tab === "home" ? home : tab === "chat" ? (current === null ? list : chat) : help}
          <nav className="flex border-t border-slate-800 bg-slate-900" aria-label={L("Support sections", "Dəstək bölmələri")}>
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => { setTab(id); if (id === "chat") setCurrent(null); }} aria-current={tab === id ? "page" : undefined} className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs ${tab === id ? "text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ICON[id]} /></svg>
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}
      {hint && !open && (
        <button onClick={() => { setHint(false); setOpen(true); }} className="wd-pop max-w-[15rem] rounded-2xl rounded-br-sm border border-white/10 bg-black px-4 py-2.5 text-left shadow-xl">
          <span className="block text-sm font-semibold text-white">{L("Need a hand?", "Köməyə ehtiyac var?")} <span aria-hidden="true">👋</span></span>
          <span className="block text-xs text-slate-400">{L("Ask Wardy anything about Wearden.", "Wearden barədə Wardy-dən soruş.")}</span>
        </button>
      )}
      {open ? (
        <button onClick={() => setOpen(false)} aria-label={L("Close support", "Dəstəyi bağla")} aria-expanded="true" className="flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black text-white shadow-xl transition hover:border-white/40">
          <svg viewBox="0 0 24 24" className="wd-spin-in h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      ) : (
        <button onClick={() => { setHint(false); setOpen(true); }} aria-label={L("Support", "Dəstək")} aria-expanded="false" className="wd-float group relative flex items-center rounded-full border border-white/15 bg-black p-1.5 shadow-xl transition-colors hover:border-white/40 focus-visible:border-white/60">
          <span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-full border border-dashed border-white/40 transition-colors group-hover:border-white/70" />
          <WardyAvatar size={46} online animated />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-medium text-white opacity-0 transition-all duration-300 group-hover:max-w-[10rem] group-hover:pl-3 group-hover:pr-3 group-hover:opacity-100 group-focus-visible:max-w-[10rem] group-focus-visible:pl-3 group-focus-visible:pr-3 group-focus-visible:opacity-100">{L("Ask Wardy", "Wardy-dən soruş")}</span>
        </button>
      )}
    </div>
  );
}
