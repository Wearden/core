import { ChangeEvent, FormEvent, ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Profile as ProfileData } from "../api";
import { setPref, usePrefs } from "../prefs";
import UserAvatar, { useProfile } from "../components/UserAvatar";
import { agentsApi } from "../agentsApi";
import { SettingRow, settingsApi } from "../settingsApi";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useFeedback } from "../components/feedback";
import { getDensity, getMotion, getThemePref, setDensity, setMotion, setThemePref, Density, Motion, ThemePref } from "../theme";
import { PageHeader, Segment } from "../components/ui";
import { btn, btnPrimary, Card, errText, field, Labeled } from "../components/settingsUi";
import AiProviders from "./settings/AiProviders";
import { Roles, Users } from "./settings/Access";

type Section = "profile" | "preferences" | "appearance" | "ai" | "agents" | "users" | "roles" | "about";

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

/** Shrinks a chosen image to a 256 px centred square and returns a data URL small enough for the profile. */
async function squareImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.getContext("2d")!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    const webp = canvas.toDataURL("image/webp", 0.85);
    // Browsers without a WebP encoder return PNG here; JPEG keeps the size down instead.
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfileCard() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const profile = useProfile();
  const [form, setForm] = useState<ProfileData | null>(null);
  useEffect(() => { if (profile.data && !form) setForm(profile.data); }, [profile.data, form]);
  const save = useMutation({
    mutationFn: (body: ProfileData) => api.updateProfile(body),
    onSuccess: (p) => { qc.setQueryData(["profile"], p); setForm(p); toast(az ? "Profil yadda saxlanıldı." : "Profile saved.", "success"); },
    onError: (e) => toast(errText(e), "error"),
  });
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !form) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast(az ? "PNG, JPEG və ya WebP şəkil seçin." : "Choose a PNG, JPEG or WebP image.", "error");
    try {
      setForm({ ...form, avatar: await squareImage(file) });
    } catch {
      toast(az ? "Şəkil oxuna bilmədi." : "The image could not be read.", "error");
    }
  };
  if (profile.error) return <Card title={az ? "Profil" : "Profile"}><p className="text-sm text-red-300">{errText(profile.error)}</p></Card>;
  if (!form) return <Card title={az ? "Profil" : "Profile"}><p className="text-sm text-slate-500">{az ? "Yüklənir..." : "Loading..."}</p></Card>;
  const dirty = JSON.stringify(form) !== JSON.stringify(profile.data);
  const set = (k: keyof ProfileData) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Card title={az ? "Profil" : "Profile"} hint={az ? "Adınız və şəkliniz menyuda və Wardy-nin salamında görünür." : "Your name and picture appear in the menu and in Wardy's greeting."}>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="flex flex-col items-center gap-3">
          <UserAvatar size={96} src={form.avatar} name={form.display_name || user?.username} />
          <div className="flex gap-2">
            <label className={`${btn} cursor-pointer`}>
              {az ? "Şəkil yüklə" : "Upload"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} />
            </label>
            {form.avatar && <button type="button" className={btn} onClick={() => setForm({ ...form, avatar: "" })}>{az ? "Sil" : "Remove"}</button>}
          </div>
          <p className="max-w-[12rem] text-center text-[11px] text-slate-500">{az ? "PNG, JPEG və ya WebP; 256×256-ya kiçildilir." : "PNG, JPEG or WebP; resized to 256×256."}</p>
        </div>
        <form className="grid flex-1 content-start gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}>
          <Labeled label={az ? "Görünən ad" : "Display name"}>
            <input className={`${field} h-9`} maxLength={60} value={form.display_name} placeholder={user?.username} onChange={set("display_name")} />
          </Labeled>
          <Labeled label={az ? "Vəzifə" : "Job title"}>
            <input className={`${field} h-9`} maxLength={60} value={form.job_title} placeholder={az ? "məs. Təhlükəsizlik mühəndisi" : "e.g. Security engineer"} onChange={set("job_title")} />
          </Labeled>
          <Labeled label={az ? "E-poçt" : "Email"}>
            <input className={`${field} h-9`} type="email" maxLength={120} value={form.email} placeholder="name@example.com" onChange={set("email")} />
          </Labeled>
          <dl className="grid gap-2 rounded-lg border border-slate-800 p-3 text-xs sm:grid-cols-3">
            <div><dt className="text-slate-500">{az ? "İstifadəçi adı" : "Username"}</dt><dd className="mt-0.5 font-mono text-slate-200">{user?.username}</dd></div>
            <div><dt className="text-slate-500">{az ? "Rol" : "Role"}</dt><dd className="mt-0.5 text-slate-200">{user?.role}</dd></div>
            <div><dt className="text-slate-500">{az ? "İcazələr" : "Permissions"}</dt><dd className="mt-0.5 text-slate-200">{user?.permissions.length ?? 0}</dd></div>
          </dl>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={!dirty || save.isPending}>{save.isPending ? "..." : az ? "Yadda saxla" : "Save changes"}</button>
            {dirty && <button type="button" className={btn} onClick={() => setForm(profile.data ?? form)}>{az ? "Ləğv et" : "Discard"}</button>}
          </div>
        </form>
      </div>
    </Card>
  );
}

function Preferences() {
  const { lang, t } = useI18n();
  const az = lang === "az";
  const prefs = usePrefs();
  const onOff = [{ id: "on", label: az ? "Açıq" : "On" }, { id: "off", label: az ? "Bağlı" : "Off" }];
  return (
    <>
      <Card title={az ? "Saat formatı" : "Time format"} hint={az ? "Bütün tarix və saatlar Bakı vaxtı ilə göstərilir." : "Every date and time is shown in Baku time."}>
        <Segment label="time format" size="md" equal value={prefs.hour12} onChange={(v) => setPref("hour12", v)} options={[{ id: "auto", label: az ? "Avtomatik" : "Automatic" }, { id: "24", label: "24h · 14:30" }, { id: "12", label: "12h · 2:30 PM" }]} />
      </Card>
      <Card title={az ? "Başlanğıc səhifə" : "Start page"} hint={az ? "Daxil olduqdan sonra açılan səhifə." : "The page that opens after you sign in."}>
        <Segment label="start page" size="md" value={prefs.startPage} onChange={(v) => setPref("startPage", v)} options={[{ id: "/", label: t("nav.dashboard") }, { id: "/assets", label: t("nav.assets") }, { id: "/scans", label: t("nav.scans") }, { id: "/hardening", label: t("nav.hardening") }, { id: "/reports", label: t("nav.reports") }]} />
      </Card>
      <Card title={az ? "Dəstək köməkçisi (Wardy)" : "Support assistant (Wardy)"} hint={az ? "Sağ aşağıdakı dəstək düyməsi. AI provayderi qurulmayıbsa onsuz da görünmür." : "The support button at the bottom right. It stays hidden while no AI provider is set."}>
        <Segment label="support assistant" size="md" equal value={prefs.assistant ? "on" : "off"} onChange={(v) => setPref("assistant", v === "on")} options={onOff} />
      </Card>
      <Card title={az ? "Canlı axın pəncərəsi" : "Live flow window"} hint={az ? "Skan və ya sərtləşdirmə işləyərkən pəncərə özü açılsın. Bağlı olanda səhifənin yuxarısındakı zolaqdan açırsınız." : "Open the window by itself while a scan or hardening run is in progress. When off, open it from the bar at the top of the page."}>
        <Segment label="live flow auto open" size="md" equal value={prefs.liveAutoOpen ? "on" : "off"} onChange={(v) => setPref("liveAutoOpen", v === "on")} options={onOff} />
      </Card>
      <p className="text-xs text-slate-500">{az ? "Bu seçimlər bu brauzerdə saxlanılır." : "These preferences are kept in this browser."}</p>
    </>
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
      <ProfileCard />
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
    preferences: true,
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
    { id: "preferences", label: az ? "Seçimlər" : "Preferences", group: az ? "Hesab" : "Account" },
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
          {section === "preferences" && <Preferences />}
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
