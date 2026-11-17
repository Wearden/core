import { FormEvent, ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { agentsApi } from "../agentsApi";
import { SettingRow, settingsApi } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import { getDensity, getMotion, getThemePref, setDensity, setMotion, setThemePref, Density, Motion, ThemePref } from "../theme";
import { PageHeader, Segment } from "../components/ui";
import { btn, btnPrimary, Card, errText, field } from "../components/settingsUi";
import AiProviders from "./settings/AiProviders";
import { Roles, Users } from "./settings/Access";

type Section = "profile" | "appearance" | "ai" | "agents" | "users" | "roles" | "about";

/** One stored setting: current source, an input, save and remove. Secret values are never shown again. */
function SettingField({ row, vaultReady, label, hint, type = "text", listId, extra }: { row: SettingRow | undefined; vaultReady: boolean; label: string; hint?: string; type?: string; listId?: string; extra?: ReactNode }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [value, setValue] = useState("");
  const done = () => {
    setValue("");
    toast(az ? "Yadda saxlanıldı." : "Saved.", "success");
    return qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const save = useMutation({ mutationFn: () => settingsApi.set(row!.key, value.trim()), onSuccess: done });
  const clear = useMutation({ mutationFn: () => settingsApi.clear(row!.key), onSuccess: done });
  if (!row) return null;
  const err = (save.error ?? clear.error) as Error | null;
  const source = row.source === "database" ? (az ? "UI-dan təyin edilib" : "Set in UI") : row.source === "environment" ? (az ? "Mühitdən" : "From environment") : az ? "Təyin edilməyib" : "Not set";
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium text-slate-200" htmlFor={`f-${row.key}`}>{label}</label>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${row.configured ? "border-slate-600 text-slate-300" : "border-slate-800 text-slate-500"}`}>{source}</span>
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {!row.secret && row.value && <p className="font-mono text-xs text-slate-400">{az ? "Cari" : "Current"}: {row.value}</p>}
      {row.secret && row.configured && <p className="text-xs text-slate-500">{az ? "Dəyər saxlanılıb. Dəyişmək üçün yenisini daxil edin." : "A value is stored. Enter a new one to replace it."}</p>}
      <div className="flex flex-wrap gap-2">
        <input id={`f-${row.key}`} className={`${field} flex-1`} type={type} list={listId} autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} placeholder={az ? "Yeni dəyər" : "New value"} />
        <button className={btnPrimary} disabled={!vaultReady || !value.trim() || save.isPending} onClick={() => save.mutate()}>{az ? "Saxla" : "Save"}</button>
        {row.source === "database" && <button className={btn} disabled={clear.isPending} onClick={() => clear.mutate()}>{az ? "Sil" : "Remove"}</button>}
        {extra}
      </div>
      {err && <p className="text-xs text-red-300">{err.message}</p>}
    </div>
  );
}

function Profile() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const change = useMutation({
    mutationFn: () => api.changePassword(cur, next),
    onSuccess: () => { setCur(""); setNext(""); setAgain(""); setMsg({ ok: true, text: az ? "Parol dəyişdirildi. Digər sessiyalar bağlandı." : "Password changed. Other sessions were signed out." }); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 12) return setMsg({ ok: false, text: az ? "Parol ən azı 12 simvol olmalıdır." : "The password must be at least 12 characters." });
    if (next !== again) return setMsg({ ok: false, text: az ? "Parollar uyğun gəlmir." : "The passwords do not match." });
    change.mutate();
  };
  return (
    <>
      <Card title={az ? "Hesab" : "Account"}>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-xl font-semibold text-slate-950">{user?.username?.[0]?.toUpperCase() ?? "?"}</span>
          <div>
            <div className="text-base font-medium text-slate-50">{user?.username}</div>
            <div className="mt-1 inline-flex rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-300">{user?.role}</div>
          </div>
        </div>
      </Card>
      <Card title={az ? "Parolu dəyiş" : "Change password"} hint={az ? "Ən azı 12 simvol. Digər sessiyalar bağlanacaq." : "At least 12 characters. Your other sessions will be signed out."}>
        <form onSubmit={submit} className="grid max-w-md gap-3">
          <input className={field} type="password" autoComplete="current-password" placeholder={az ? "Cari parol" : "Current password"} value={cur} onChange={(e) => setCur(e.target.value)} />
          <input className={field} type="password" autoComplete="new-password" placeholder={az ? "Yeni parol" : "New password"} value={next} onChange={(e) => setNext(e.target.value)} />
          <input className={field} type="password" autoComplete="new-password" placeholder={az ? "Yeni parolu təkrarla" : "Repeat new password"} value={again} onChange={(e) => setAgain(e.target.value)} />
          <div className="flex items-center gap-3">
            <button className={btnPrimary} disabled={!cur || !next || change.isPending}>{az ? "Parolu yenilə" : "Update password"}</button>
            {msg && <span className={`text-xs ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>{msg.text}</span>}
          </div>
        </form>
      </Card>
    </>
  );
}

function Appearance() {
  const { lang, setLang } = useI18n();
  const az = lang === "az";
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [density, setDens] = useState<Density>(getDensity);
  const [motion, setMotionPref] = useState<Motion>(getMotion);
  return (
    <>
      <Card title={az ? "Tema" : "Theme"} hint={az ? "Qara, ağ və ya sistem ayarı." : "Black, white or follow the system setting."}>
        <Segment label="theme" size="md" equal value={theme} onChange={(v) => { setTheme(v); setThemePref(v); }} options={[{ id: "dark", label: az ? "Qara" : "Black" }, { id: "light", label: az ? "Ağ" : "White" }, { id: "system", label: az ? "Sistem" : "System" }]} />
      </Card>
      <Card title={az ? "Cədvəl sıxlığı" : "Table density"} hint={az ? "Sıx rejim bir ekrana daha çox sətir sığdırır." : "Compact fits more rows on screen."}>
        <Segment label="table density" size="md" equal value={density} onChange={(v) => { setDens(v); setDensity(v); }} options={[{ id: "comfortable", label: az ? "Rahat" : "Comfortable" }, { id: "compact", label: az ? "Sıx" : "Compact" }]} />
      </Card>
      <Card title={az ? "Animasiyalar" : "Animations"} hint={az ? "Sistem seçimi əməliyyat sisteminin 'hərəkəti azalt' ayarına tabe olur. Windows-da animasiyalar söndürülübsə, Açıq seçin." : "System follows the operating system reduce motion setting. If animations are switched off in Windows, choose On."}>
        <Segment label="animations" size="md" equal value={motion} onChange={(v) => { setMotionPref(v); setMotion(v); }} options={[{ id: "on", label: az ? "Açıq" : "On" }, { id: "system", label: az ? "Sistem" : "System" }, { id: "off", label: az ? "Bağlı" : "Off" }]} />
      </Card>
      <Card title={az ? "Dil" : "Language"}>
        <Segment label="language" size="md" equal value={lang} onChange={setLang} options={[{ id: "en", label: "English" }, { id: "az", label: "Azərbaycanca" }]} />
      </Card>
    </>
  );
}

function AgentSettings({ rows, vaultReady }: { rows: SettingRow[]; vaultReady: boolean }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const info = useQuery({ queryKey: ["install-info"], queryFn: agentsApi.installInfo });
  return (
    <>
      <Card title={az ? "Agent logları" : "Agent logs"} hint={az ? "Agentlərin göndərdiyi status loglarının saxlanma müddəti." : "How long operational logs sent by agents are kept."}>
        <SettingField row={rows.find((r) => r.key === "log_retention_days")} vaultReady={vaultReady} label={az ? "Saxlama müddəti (gün)" : "Retention (days)"} hint={az ? "1 ilə 365 arası. Boş buraxılsa 30 gün." : "1 to 365. Defaults to 30 days when unset."} />
      </Card>
      <Card title={az ? "Agent quraşdırma paketi" : "Agent install package"} hint={az ? "Core agent binary-sini və quraşdırma skriptini verir." : "Core serves the agent binary and the installer script."}>
        <div className="flex items-center gap-2 text-sm">
          <span aria-hidden className={`h-2 w-2 rounded-full ${info.data?.linux_available ? "bg-emerald-400" : "bg-amber-400"}`} />
          <span className="text-slate-200">{info.data?.linux_available ? (az ? "Linux paketi mövcuddur" : "Linux package is available") : az ? "Linux paketi yoxdur" : "Linux package is missing"}</span>
        </div>
        <p className="text-xs text-slate-500">{az ? "Mövcud deyilsə, AGENT_DOWNLOADS_DIR qovluğuna wearden-agent-linux-amd64 və SHA256SUMS faylını qoyun." : "If missing, place wearden-agent-linux-amd64 and SHA256SUMS in the AGENT_DOWNLOADS_DIR folder."}</p>
        <p className="text-xs text-slate-500">{az ? "Token yaratmaq və tək əmri görmək üçün Aktivlər səhifəsindəki Agentlər bölməsinə keçin." : "To create a token and see the one-line command, use the Agents section on the Assets page."}</p>
      </Card>
    </>
  );
}

function About() {
  const { lang } = useI18n();
  const az = lang === "az";
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15_000 });
  const ready = useQuery({ queryKey: ["ready"], queryFn: api.ready, refetchInterval: 15_000 });
  const Row = ({ k, v, ok }: { k: string; v: string; ok?: boolean }) => (
    <div className="flex items-center justify-between border-b border-slate-800/70 py-2 text-sm last:border-0">
      <span className="text-slate-400">{k}</span>
      <span className="flex items-center gap-2 text-slate-100">{ok !== undefined && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"}`} />}{v}</span>
    </div>
  );
  return (
    <Card title={az ? "Sistem" : "System"}>
      <div>
        <Row k="API" v={health.data?.status === "ok" ? (az ? "işləyir" : "running") : az ? "əlçatmaz" : "unreachable"} ok={health.data?.status === "ok"} />
        <Row k={az ? "Verilənlər bazası" : "Database"} v={ready.data?.database === "ok" ? (az ? "qoşulub" : "connected") : az ? "mövcud deyil" : "unavailable"} ok={ready.data?.database === "ok"} />
        <Row k={az ? "Ünvan" : "Address"} v={window.location.origin} />
        <Row k={az ? "Agent protokolu" : "Agent protocol"} v="v1 (REST + JSON Schema)" />
      </div>
    </Card>
  );
}

export default function Settings() {
  const { can, user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const [params, setParams] = useSearchParams();
  const section = (params.get("section") as Section) || "profile";
  const allowed: Record<Section, boolean> = {
    profile: true,
    appearance: true,
    ai: can("ai.manage"),
    agents: can("settings.manage"),
    users: can("users.manage"),
    roles: can("users.manage"),
    about: true,
  };
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.list, enabled: can("settings.manage") });
  useEffect(() => {
    if (user && !allowed[section]) setParams({ section: "profile" }, { replace: true });
  }, [user, allowed, section, setParams]);

  const nav: { id: Section; label: string; group: string }[] = [
    { id: "profile", label: az ? "Profil" : "Profile", group: az ? "Hesab" : "Account" },
    { id: "appearance", label: az ? "Görünüş" : "Appearance", group: az ? "Hesab" : "Account" },
    { id: "ai", label: az ? "AI provayderləri" : "AI providers", group: az ? "Platforma" : "Platform" },
    { id: "agents", label: az ? "Agentlər və loglar" : "Agents and logs", group: az ? "Platforma" : "Platform" },
    { id: "users", label: az ? "İstifadəçilər" : "Users", group: az ? "Giriş" : "Access" },
    { id: "roles", label: az ? "Rollar və icazələr" : "Roles and permissions", group: az ? "Giriş" : "Access" },
    { id: "about", label: az ? "Sistem" : "System", group: az ? "Sistem" : "System" },
  ];
  const visible = nav.filter((n) => allowed[n.id]);
  const groups = Array.from(new Set(visible.map((n) => n.group)));
  const rows = settings.data?.settings ?? [];
  const vaultReady = settings.data?.vault_ready ?? false;

  return (
    <div className="space-y-6">
      <PageHeader title={az ? "Parametrlər" : "Settings"} subtitle={az ? "Hesabınızı, görünüşü, AI provayderlərini, istifadəçiləri və rolları idarə edin." : "Manage your account, the appearance, AI providers, users and roles."} />
      <div className="grid gap-6 lg:grid-cols-[230px_1fr]">
        <nav className="flex gap-4 overflow-x-auto lg:flex-col lg:gap-5" aria-label="settings sections">
          {groups.map((g) => (
            <div key={g} className="flex gap-1 lg:flex-col">
              <div className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-wider text-slate-500 lg:block">{g}</div>
              {visible.filter((n) => n.group === g).map((n) => (
                <button key={n.id} onClick={() => setParams({ section: n.id })} aria-current={section === n.id ? "page" : undefined} className={`h-9 whitespace-nowrap rounded-md px-3 text-left text-sm ${section === n.id ? "bg-slate-800 font-medium text-slate-50" : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"}`}>{n.label}</button>
              ))}
            </div>
          ))}
        </nav>
        <div className={`min-w-0 space-y-5 ${section === "users" || section === "roles" ? "max-w-5xl" : "max-w-3xl"}`}>
          {section === "agents" && can("settings.manage") && settings.data && !vaultReady && (
            <p className="rounded-md border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300">{az ? "WEARDEN_VAULT_KEY server mühitində təyin edilməyib, ona görə dəyərləri yadda saxlamaq olmur." : "WEARDEN_VAULT_KEY is not set in the server environment, so values cannot be saved yet."}</p>
          )}
          {section === "profile" && <Profile />}
          {section === "appearance" && <Appearance />}
          {section === "ai" && allowed.ai && <AiProviders />}
          {section === "agents" && allowed.agents && <AgentSettings rows={rows} vaultReady={vaultReady} />}
          {section === "users" && allowed.users && <Users />}
          {section === "roles" && allowed.roles && <Roles />}
          {section === "about" && <About />}
        </div>
      </div>
    </div>
  );
}
