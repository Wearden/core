import { FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n";
import Logo from "../components/Logo";
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
      <span style={{ width: size, height: size }} className="flex items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-slate-950"><Logo className="h-[55%] w-auto" /></span>
      <span className="text-base font-semibold tracking-tight text-slate-50">Wearden</span>
    </span>
  );
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

type Mode = "signin" | "register" | "requested";

export default function Login() {
  const { login } = useAuth();
  const { t, lang, setLang } = useI18n();
  const az = lang === "az";
  const light = useIsLight();
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setup, retry: false });
  const firstRun = setup.data ? !setup.data.admin_exists : false;
  const canRegister = !!setup.data && (firstRun || setup.data.registration_open);
  const [wanted, setWanted] = useState<Mode>("signin");
  const mode: Mode = firstRun ? "register" : wanted === "register" && !canRegister ? "signin" : wanted;
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.status === 429) setError(t("login.tooMany"));
    else if (err instanceof ApiError && err.status === 401) setError(t("login.wrong"));
    else if (err instanceof ApiError && [400, 403, 409].includes(err.status)) setError(err.message);
    else setError(t("login.unreachable"));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register") {
      if (password.length < 12) return setError(az ? "Parol ən azı 12 simvol olmalıdır." : "The password must be at least 12 characters.");
      if (password !== again) return setError(az ? "Parollar uyğun gəlmir." : "The passwords do not match.");
    }
    setPending(true);
    try {
      if (mode === "register") {
        const res = await api.register(username, password);
        if (res.status === "admin") await login(username, password);
        else {
          setPassword("");
          setAgain("");
          setWanted("requested");
        }
      } else {
        await login(username, password);
      }
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
    }
  };

  const switchMode = (m: Mode) => {
    setError(null);
    setWanted(m);
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
              <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
                {mode === "requested" ? (az ? "Sorğu göndərildi" : "Request sent") : firstRun ? (az ? "Administrator hesabı yaradın" : "Create the administrator account") : mode === "register" ? (az ? "Hesab sorğusu" : "Request an account") : az ? "Hesabınıza daxil olun" : "Sign in to your account"}
              </h1>
              <p className="text-sm text-slate-400">
                {mode === "requested"
                  ? az ? "Administrator hesabınızı təsdiq edənə qədər daxil ola bilməzsiniz." : "You can sign in once the administrator approves your account."
                  : firstRun
                    ? az ? "Siz buradakı ilk istifadəçisiniz. Bu hesab yeganə administrator olacaq." : "You are the first person here. This account becomes the one and only administrator."
                    : mode === "register"
                      ? az ? "Hesab yaradılır və administratorun təsdiqini gözləyir." : "Your account is created and waits for the administrator to approve it."
                      : t("login.tagline")}
              </p>
            </div>

            {mode === "requested" ? (
              <button type="button" onClick={() => switchMode("signin")} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-700 text-sm font-medium text-slate-200 hover:bg-slate-800">
                {az ? "Girişə qayıt" : "Back to sign in"}
              </button>
            ) : (
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
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
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
                {mode === "register" && <span className="block text-xs text-slate-500">{az ? "Ən azı 12 simvol." : "At least 12 characters."}</span>}
              </label>

              {mode === "register" && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-slate-300">{az ? "Parolu təkrarla" : "Repeat password"}</span>
                  <span className={inputWrap}>
                    <svg {...iconProps}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                    <input className={input} type={show ? "text" : "password"} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required placeholder="••••••••••••" />
                  </span>
                </label>
              )}

              {error && (
                <p role="alert" className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}

              <button type="submit" disabled={pending || !username || !password || (mode === "register" && !again)} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-100 text-sm font-medium text-slate-950 shadow-sm transition-colors hover:bg-white disabled:opacity-50">
                {pending ? t("login.signingIn") : mode === "register" ? (firstRun ? (az ? "Administrator yarat" : "Create administrator") : az ? "Sorğu göndər" : "Send request") : t("login.signIn")}
                {!pending && (
                  <svg {...iconProps}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                )}
              </button>
            </form>
            )}
          </div>

          <div className="mt-8 flex items-center justify-between gap-3 text-xs text-slate-500">
            {mode === "signin" && canRegister ? (
              <button type="button" onClick={() => switchMode("register")} className="text-left text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">{az ? "Hesabınız yoxdur? Sorğu göndərin" : "No account? Request one"}</button>
            ) : mode === "register" && !firstRun ? (
              <button type="button" onClick={() => switchMode("signin")} className="text-left text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">{az ? "Hesabınız var? Daxil olun" : "Have an account? Sign in"}</button>
            ) : (
              <span>{firstRun ? (az ? "İlk quraşdırma" : "First time setup") : az ? "Giriş problemi? Administratorla əlaqə saxlayın." : "Need access? Contact your administrator."}</span>
            )}
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
