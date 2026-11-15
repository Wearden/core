import { useState } from "react";
import { request } from "../api";
import { useI18n } from "../i18n";

interface Explanation {
  control_id: string;
  source: "ai" | "static";
  text: string;
}

/** Plain-language explanation of one control. Uses the AI copilot when a key is configured, else the YAML text. */
export default function CopilotPanel({ benchmarkId, controlId }: { benchmarkId: string; controlId: string }) {
  const { t, lang } = useI18n();
  const [result, setResult] = useState<Explanation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explain = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await request<Explanation>("/copilot/explain", {
        method: "POST",
        body: JSON.stringify({ benchmark_id: benchmarkId, control_id: controlId, language: lang }),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("copilot.loadFail"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <button onClick={explain} disabled={busy} className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40">
        {busy ? "…" : t("common.explain")}
      </button>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {result && (
        <div className="rounded-lg border border-cyan-900 bg-cyan-950/30 p-3 text-xs">
          <div className="mb-1 font-medium text-cyan-200">{t("copilot.title")}</div>
          <p className="whitespace-pre-line text-slate-200">{result.text}</p>
          <p className="mt-2 text-slate-500">{result.source === "ai" ? t("copilot.aiNote") : t("copilot.staticNote")}</p>
        </div>
      )}
    </div>
  );
}
