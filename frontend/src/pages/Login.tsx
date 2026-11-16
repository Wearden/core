import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../auth";
import { ApiError } from "../api";
import { useI18n } from "../i18n";
import CursorGrid from "../components/CursorGrid";

/** Follows the data-theme attribute so the animated grid keeps its contrast in both themes. */
function useIsLight(): boolean {
  const read = () => document.documentElement.dataset.theme === "light";
  const [light, setLight] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setLight(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

function Brand({ size = 28 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <span style={{ width: size, height: size }} className="flex items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-950">W</span>
      <span className="text-base font-semibold tracking-tight text-slate-50">Wearden</span>
    </span>
  );
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export default function Login() {
  const { login } = useAuth();
  const { t, lang, setLang } = useI18n();
  const az = lang === "az";
  const light = useIsLight();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await login(username, password);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError(t("login.tooMany"));
      else if (err instanceof ApiError && err.status === 401) setError(t("login.wrong"));
      else setError(t("login.unreachable"));
    } finally {
      setPending(false);
    }
  };

  const inputWrap = "flex h-11 items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950 px-3 text-slate-500 focus-within:border-slate-400 focus-within:text-slate-300 focus-within:ring-2 focus-within:ring-slate-500/30";
  const input = "h-full min-w-0 flex-1 rounded-none bg-transparent text-sm text-slate-50 outline-none focus-visible:outline-none placeholder:text-slate-500";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 sm:p-8">
      <div className="grid min-h-[34rem] w-full max-w-[1000px] overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col justify-between p-7 sm:p-9">
          <div className="space-y-8">
            <Brand />
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50">{az ? "Hesabınıza daxil olun" : "Sign in to your account"}</h1>
              <p className="text-sm text-slate-400">{t("login.tagline")}</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">{t("login.username")}</span>
                <span className={inputWrap}>
                  <svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
                  <input className={input} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required placeholder={az ? "istifadəçi adı" : "your username"} />
                </span>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-300">{t("login.password")}</span>
                <span className={inputWrap}>
                  <svg {...iconProps}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                  <input
                    className={input}
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
                    onBlur={() => setCaps(false)}
                    autoComplete="current-password"
                    required
                    placeholder="••••••••••••"
                  />
                  <button type="button" onClick={() => setShow(!show)} aria-label={show ? (az ? "Parolu gizlət" : "Hide password") : az ? "Parolu göstər" : "Show password"} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-200">
                    {show ? (
                      <svg {...iconProps}><path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a15 15 0 0 1-3.2 3.7M6.6 6.6C4 8.4 3 12 3 12s4 6 9 6c1.4 0 2.7-.4 3.9-1" /></svg>
                    ) : (
                      <svg {...iconProps}><path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                  </button>
                </span>
                {caps && <span className="block text-xs text-amber-400">{az ? "Caps Lock açıqdır." : "Caps Lock is on."}</span>}
              </label>

              {error && (
                <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}

              <button type="submit" disabled={pending || !username || !password} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-medium text-slate-950 shadow-sm transition-colors hover:bg-white disabled:opacity-50">
                {pending ? t("login.signingIn") : t("login.signIn")}
                {!pending && (
                  <svg {...iconProps}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                )}
              </button>
            </form>
          </div>

          <div className="mt-8 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{az ? "Giriş problemi? Administratorla əlaqə saxlayın." : "Need access? Contact your administrator."}</span>
            <span className="flex overflow-hidden rounded-md border border-slate-800" role="group" aria-label="language">
              {(["en", "az"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`px-2 py-1 uppercase ${lang === l ? "bg-slate-100 text-slate-950" : "text-slate-400 hover:bg-slate-800"}`}>{l}</button>
              ))}
            </span>
          </div>
        </div>

        <div className="relative hidden border-l border-slate-800 bg-slate-950 md:block">
          <CursorGrid lightMode={light} cellSize={44} radius={150} fillOpacity={0.09} gridOpacity={light ? 0.1 : 0.07} edgeFade={0.12} spotlight={0.5} holdTime={500} fadeDuration={900} style={{ position: "absolute", inset: 0 }} />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-slate-950 via-slate-950/80 to-transparent p-9 pt-24">
            <h2 className="max-w-sm text-2xl font-semibold leading-snug tracking-tight text-slate-50">{az ? "Hər iş stansiyasını əminliklə möhkəmləndirin" : "Harden every workstation with confidence"}</h2>
            <p className="max-w-sm text-sm text-slate-400">{az ? "CIS benchmark ilə yoxlayın, dəyişiklikləri geri qaytarma ilə tətbiq edin və tam audit izi saxlayın." : "Scan against CIS benchmarks, apply changes with rollback, and keep a full audit trail."}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
