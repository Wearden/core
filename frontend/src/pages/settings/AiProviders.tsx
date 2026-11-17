import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiAdminApi, AiProvider, AiProviderInput, ProviderKind } from "../../settingsApi";
import { useI18n } from "../../i18n";
import { useFeedback } from "../../components/feedback";
import { btn, btnDanger, btnPrimary, btnSmall, Card, Dialog, errText, field, Labeled } from "../../components/settingsUi";

interface Preset {
  id: string;
  label: string;
  kind: ProviderKind;
  base_url: string;
  name: string;
  local: boolean;
  hint: string;
}

const PRESETS: Preset[] = [
  { id: "anthropic", label: "Anthropic", kind: "anthropic", base_url: "https://api.anthropic.com", name: "Anthropic", local: false, hint: "Hosted Claude models. Needs an API key." },
  { id: "openai", label: "OpenAI", kind: "openai", base_url: "https://api.openai.com/v1", name: "OpenAI", local: false, hint: "Hosted GPT models. Needs an API key." },
  { id: "ollama", label: "Ollama (local)", kind: "openai", base_url: "http://localhost:11434/v1", name: "Ollama (local)", local: true, hint: "Runs on your own hardware. No key needed. The model must support tool calling." },
  { id: "lmstudio", label: "LM Studio (local)", kind: "openai", base_url: "http://localhost:1234/v1", name: "LM Studio (local)", local: true, hint: "Local server with the OpenAI compatible API. No key needed." },
  { id: "deepseek", label: "DeepSeek", kind: "openai", base_url: "https://api.deepseek.com/v1", name: "DeepSeek", local: false, hint: "Hosted DeepSeek models. Needs an API key." },
  { id: "gemini", label: "Google Gemini", kind: "openai", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", name: "Google Gemini", local: false, hint: "Gemini through its OpenAI compatible endpoint. Needs an API key." },
  { id: "groq", label: "Groq", kind: "openai", base_url: "https://api.groq.com/openai/v1", name: "Groq", local: false, hint: "Hosted open models on Groq. Needs an API key." },
  { id: "openrouter", label: "OpenRouter", kind: "openai", base_url: "https://openrouter.ai/api/v1", name: "OpenRouter", local: false, hint: "Many models behind one key. Use the full model id, for example vendor/model." },
  { id: "mistral", label: "Mistral", kind: "openai", base_url: "https://api.mistral.ai/v1", name: "Mistral", local: false, hint: "Hosted Mistral models. Needs an API key." },
  { id: "custom", label: "Custom OpenAI compatible", kind: "openai", base_url: "", name: "", local: false, hint: "vLLM, llama.cpp, OpenRouter, a company gateway or any server that speaks the OpenAI chat API." },
];

const emptyForm = { name: "", kind: "openai" as ProviderKind, base_url: "", model: "", api_key: "", clear_key: false, enabled: true };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ProviderDialog({ initial, onClose, vaultReady }: { initial: AiProvider | null; onClose: () => void; vaultReady: boolean }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const [preset, setPreset] = useState<string>(initial ? "" : "ollama");
  const [form, setForm] = useState(() => {
    if (initial) return { name: initial.name, kind: initial.kind, base_url: initial.base_url, model: initial.model, api_key: "", clear_key: false, enabled: initial.enabled };
    const p = PRESETS.find((x) => x.id === "ollama")!;
    return { ...emptyForm, name: p.name, kind: p.kind, base_url: p.base_url };
  });
  const models = useMutation({ mutationFn: () => aiAdminApi.models(initial!.id) });
  const body = (): AiProviderInput => {
    const b: AiProviderInput = { name: form.name, kind: form.kind, base_url: form.base_url, model: form.model, enabled: form.enabled };
    if (form.api_key) b.api_key = form.api_key;
    return b;
  };
  const check = useMutation({ mutationFn: () => aiAdminApi.check({ ...body(), name: form.name.trim() || "check", id: initial?.id }) });
  useEffect(() => { check.reset(); }, [form]); // a result only describes the values it was run with
  const choose = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    setPreset(id);
    setForm({ ...form, name: p.name, kind: p.kind, base_url: p.base_url });
  };
  const save = useMutation({
    mutationFn: () => {
      const b = body();
      if (form.clear_key) b.clear_key = true;
      return initial ? aiAdminApi.update(initial.id, b) : aiAdminApi.create(b);
    },
    onSuccess: () => {
      toast(initial ? (az ? "Provayder yeniləndi." : "Provider updated.") : az ? "Provayder əlavə edildi." : "Provider added.", "success");
      qc.invalidateQueries({ queryKey: ["ai-providers"] });
      qc.invalidateQueries({ queryKey: ["ai-status"] });
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const current = PRESETS.find((p) => p.id === preset);
  return (
    <Dialog title={initial ? (az ? "Provayderi redaktə et" : "Edit provider") : az ? "AI provayder əlavə et" : "Add an AI provider"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {!initial && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-300">{az ? "Növ" : "Type"}</div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="provider presets">
              {PRESETS.map((p) => (
                <button type="button" key={p.id} onClick={() => choose(p.id)} aria-pressed={preset === p.id} className={`inline-flex h-8 items-center rounded-full border px-3 text-xs ${preset === p.id ? "border-slate-100 bg-slate-100 text-slate-950" : "border-slate-800 text-slate-300 hover:bg-slate-800"}`}>{p.label}</button>
              ))}
            </div>
            {current && <p className="text-xs text-slate-500">{current.hint}</p>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Labeled label={az ? "Ad" : "Name"}>
            <input className={`${field} h-9`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ollama (local)" maxLength={60} required />
          </Labeled>
          <Labeled label={az ? "Protokol" : "Protocol"}>
            <select className={`${field} h-9`} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ProviderKind })}>
              <option value="openai">OpenAI compatible (also local)</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Labeled>
        </div>
        <Labeled label={az ? "Baza ünvan" : "Base URL"} hint={az ? "Yerli server üçün core serverindən əlçatan olmalıdır. Boş buraxsanız standart ünvan istifadə olunur." : "A local server must be reachable from the machine that runs Wearden core. Leave empty for the provider default."}>
          <input className={`${field} h-9 font-mono`} value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="http://localhost:11434/v1" />
        </Labeled>
        <Labeled label={az ? "Model" : "Model"} hint={az ? "İstənilən model adı yaza bilərsiniz. Bağlantını yoxlayanda provayderin siyahısı da yüklənir." : "Type any model name. Checking the connection also loads the provider's model list."}>
          <div className="flex gap-2">
            <input className={`${field} h-9 flex-1 font-mono`} list="provider-models" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="llama3.1:8b" required />
            {initial && <button type="button" className={btn} disabled={models.isPending} onClick={() => models.mutate()}>{models.isPending ? "..." : az ? "Siyahını yüklə" : "Load models"}</button>}
          </div>
          <datalist id="provider-models">{(check.data?.models ?? models.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
          {models.error && <span className="block text-xs text-red-300">{errText(models.error)}</span>}
          {models.data && <span className="block text-xs text-slate-500">{models.data.length} {az ? "model tapıldı." : "models found, suggested while you type."}</span>}
        </Labeled>
        <Labeled label={az ? "API açarı (istəyə görə)" : "API key (optional)"} hint={initial?.has_key ? (az ? "Açar saxlanılıb. Dəyişmək üçün yenisini yazın." : "A key is stored. Type a new one to replace it.") : az ? "Yerli serverlər üçün boş buraxın. Açar vault ilə şifrələnir və bir daha göstərilmir." : "Leave empty for local servers. The key is encrypted with the vault and never shown again."}>
          <input className={`${field} h-9`} type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} disabled={!vaultReady} placeholder={vaultReady ? "" : "WEARDEN_VAULT_KEY"} />
        </Labeled>
        {initial?.has_key && (
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.clear_key} onChange={(e) => setForm({ ...form, clear_key: e.target.checked })} />{az ? "Saxlanılmış açarı sil" : "Remove the stored key"}</label>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />{az ? "Aktivdir" : "Enabled"}</label>
        {check.error && <p className="text-xs text-red-300">{errText(check.error)}</p>}
        {check.data && (
          <p role="status" className={`rounded border px-3 py-2 text-xs ${check.data.ok ? "border-emerald-900 bg-emerald-950/40 text-emerald-200" : "border-red-900 bg-red-950/40 text-red-200"}`}>
            {check.data.ok ? (az ? "Bağlantı işləyir" : "Connection works") : az ? "Bağlantı alınmadı" : "Connection failed"}
            {check.data.ok ? ` · ${check.data.latency_ms} ms` : ` · ${check.data.message}`}
            {check.data.ok && check.data.models && check.data.models.length > 0 && !check.data.model_listed && (az ? ". Bu model provayderin siyahısında yoxdur, amma cavab verdi." : ". This model is not in the provider's list, but it answered.")}
          </p>
        )}
        {save.error && <p className="text-xs text-red-300">{errText(save.error)}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
          <button type="button" className={btn} onClick={onClose}>{az ? "Ləğv et" : "Cancel"}</button>
          <button type="button" className={btn} disabled={check.isPending || !form.model.trim()} onClick={() => check.mutate()}>{check.isPending ? (az ? "Yoxlanır..." : "Checking...") : az ? "Bağlantını yoxla" : "Check connection"}</button>
          <button className={btnPrimary} disabled={save.isPending || !form.name.trim() || !form.model.trim()}>{save.isPending ? "..." : az ? "Saxla" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ProviderCard({ p }: { p: AiProvider }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const qc = useQueryClient();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState(false);
  const test = useMutation({ mutationFn: () => aiAdminApi.test(p.id) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai-providers"] });
    qc.invalidateQueries({ queryKey: ["ai-status"] });
  };
  const useForChat = useMutation({ mutationFn: () => (p.chat ? aiAdminApi.chatFollowsDefault() : aiAdminApi.useForChat(p.id)), onSuccess: () => { toast(az ? "Çat provayderi dəyişdi." : "Chat provider changed.", "success"); refresh(); }, onError: (e) => toast(errText(e), "error") });
  const makeDefault = useMutation({ mutationFn: () => aiAdminApi.makeDefault(p.id), onSuccess: () => { toast(az ? "Standart provayder dəyişdi." : "Default provider changed.", "success"); refresh(); }, onError: (e) => toast(errText(e), "error") });
  const remove = useMutation({ mutationFn: () => aiAdminApi.remove(p.id), onSuccess: () => { toast(az ? "Provayder silindi." : "Provider deleted.", "success"); refresh(); }, onError: (e) => toast(errText(e), "error") });
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(hostOf(p.base_url).replace(/:\d+$/, ""));
  return (
    <div className={`rounded-lg border p-4 ${p.default ? "border-slate-500 bg-slate-950" : "border-slate-800 bg-slate-950"} ${p.enabled ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-50">{p.name}</span>
            {p.default && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-950">{az ? "analiz (standart)" : "analysis (default)"}</span>}
            {p.chat && <span className="rounded-full bg-cyan-900/60 px-2 py-0.5 text-[11px] font-medium text-cyan-200">{az ? "çat" : "chat"}</span>}
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">{p.kind === "anthropic" ? "Anthropic" : "OpenAI compatible"}</span>
            {local && <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">{az ? "yerli" : "local"}</span>}
            {!p.enabled && <span className="rounded-full border border-slate-800 px-2 py-0.5 text-[11px] text-slate-500">{az ? "söndürülüb" : "disabled"}</span>}
            {p.readonly && <span className="rounded-full border border-slate-800 px-2 py-0.5 text-[11px] text-slate-500">{az ? "köhnə parametrlərdən" : "from legacy settings"}</span>}
          </div>
          <div className="mt-1 text-xs text-slate-400"><span className="font-mono">{p.model}</span> · <span className="font-mono">{hostOf(p.base_url)}</span> · {p.has_key ? (az ? "açar saxlanılıb" : "key stored") : az ? "açarsız" : "no key"}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnSmall} onClick={() => test.mutate()} disabled={test.isPending || !p.enabled}>{test.isPending ? (az ? "Yoxlanır..." : "Testing...") : az ? "Yoxla" : "Test"}</button>
          {!p.default && p.enabled && <button className={btnSmall} onClick={() => makeDefault.mutate()} disabled={makeDefault.isPending}>{az ? "Standart et" : "Make default"}</button>}
          {(p.chat || p.enabled) && <button className={btnSmall} onClick={() => useForChat.mutate()} disabled={useForChat.isPending}>{p.chat ? (az ? "Çat standartı izləsin" : "Chat: follow default") : az ? "Çat üçün istifadə et" : "Use for chat"}</button>}
          {!p.readonly && <button className={btnSmall} onClick={() => setEditing(true)}>{az ? "Redaktə" : "Edit"}</button>}
          {!p.readonly && (
            <button className={btnDanger} onClick={async () => (await confirm({ title: az ? `${p.name} silinsin?` : `Delete ${p.name}?`, message: az ? "Bu provayder artıq analiz üçün istifadə olunmayacaq." : "This provider will no longer be used for analysis.", confirmLabel: az ? "Sil" : "Delete", cancelLabel: az ? "Vaz keç" : "Cancel", danger: true })) && remove.mutate()}>{az ? "Sil" : "Delete"}</button>
          )}
        </div>
      </div>
      {test.data && <p className={`mt-3 text-xs ${test.data.ok ? "text-emerald-300" : "text-red-300"}`}>{test.data.message}{test.data.ok && test.data.latency_ms !== undefined ? ` (${test.data.latency_ms} ms)` : ""}</p>}
      {test.error && <p className="mt-3 text-xs text-red-300">{errText(test.error)}</p>}
      {editing && <ProviderDialog initial={p} onClose={() => setEditing(false)} vaultReady />}
    </div>
  );
}

export default function AiProviders() {
  const { lang } = useI18n();
  const az = lang === "az";
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ["ai-providers"], queryFn: aiAdminApi.providers });
  const providers = list.data?.providers ?? [];
  const vaultReady = list.data?.vault_ready ?? false;
  return (
    <>
      <Card
        title={az ? "AI provayderləri" : "AI providers"}
        hint={az ? "İstədiyiniz qədər provayder əlavə edin: bulud API və ya öz serverinizdə işləyən yerli model. Analiz standart provayderlə işləyir; dəstək çatı ayrıca seçilmiş provayderi, seçilməyibsə standartı istifadə edir." : "Add as many providers as you like: a cloud API or a local model on your own server. Analysis uses the default provider; the support chat uses its own provider if you pick one, otherwise the default."}
        action={<button className={btnPrimary} onClick={() => setAdding(true)}>{az ? "Provayder əlavə et" : "Add provider"}</button>}
      >
        {list.isLoading && <p className="text-sm text-slate-500">{az ? "Yüklənir..." : "Loading..."}</p>}
        {list.error && <p className="text-sm text-red-300">{errText(list.error)}</p>}
        {list.data && providers.length === 0 && (
          <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
            {az ? "Hələ provayder yoxdur. AI analizini işə salmaq üçün birini əlavə edin." : "No provider yet. Add one to turn on AI analysis."}
          </div>
        )}
        <div className="space-y-3">{providers.map((p) => <ProviderCard key={p.id} p={p} />)}</div>
        {list.data && !vaultReady && <p className="text-xs text-slate-500">{az ? "WEARDEN_VAULT_KEY təyin edilməyib: açar yaza bilməzsiniz, amma açarsız yerli provayderlər işləyir." : "WEARDEN_VAULT_KEY is not set: keys cannot be stored, but local providers without a key still work."}</p>}
      </Card>
      <Card title={az ? "Məxfilik" : "Privacy"}>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
          <li>{az ? "Provayderə yalnız toplanmış nəzarət faktları göndərilir: host adları, sübut dəyərləri və giriş məlumatları göndərilmir." : "Only aggregated control facts leave the server: no host names, evidence values or credentials."}</li>
          <li>{az ? "Tam məxfilik üçün yerli model (Ollama, LM Studio) seçin, məlumat serverinizdən çıxmır." : "For full privacy pick a local model (Ollama, LM Studio): nothing leaves your network."}</li>
          <li>{az ? "AI yalnız məsləhət verir. Heç nə avtomatik tətbiq olunmur." : "The AI only advises. Nothing is applied automatically."}</li>
        </ul>
      </Card>
      {adding && <ProviderDialog initial={null} onClose={() => setAdding(false)} vaultReady={vaultReady} />}
    </>
  );
}
