import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi, RemoteInstallResult } from "../agentsApi";
import { benchmarksApi } from "../benchmarksApi";
import { useI18n } from "../i18n";
import type { Asset } from "../types";

interface Props {
  asset: Asset;
  onClose: () => void;
  /** Called after a successful installation so the host list can refresh. */
  onInstalled: () => void;
}

const field = "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-cyan-500";

/**
 * Installs the agent on a host over SSH with the stored credential. The SSH host key is shown
 * and must be confirmed before the credential is sent. Scans and hardening then run through the agent.
 */
export default function RemoteInstallModal({ asset, onClose, onInstalled }: Props) {
  const { lang, t } = useI18n();
  const az = lang === "az";
  const benchmarks = useQuery({ queryKey: ["benchmarks"], queryFn: benchmarksApi.list });
  const info = useQuery({ queryKey: ["install-info"], queryFn: agentsApi.installInfo });
  const [benchmarkId, setBenchmarkId] = useState("");
  const [remediation, setRemediation] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemoteInstallResult | null>(null);

  const sameOs = (benchmarks.data ?? []).filter((b) => b.os === asset.os_type);
  const native = sameOs.filter((b) => b.id.includes("-native"));
  const eligible = native.length > 0 ? native : sameOs;
  const activeBenchmark = eligible.find((b) => b.id === benchmarkId)?.id ?? eligible[0]?.id ?? "";
  const binaryReady = asset.os_type === "linux" ? info.data?.linux_available : info.data?.windows_available;
  const ready = !!info.data?.remote_install_ready && !!binaryReady;
  const awaitingKey = result?.status === "confirm_host_key";
  const installed = result?.status === "installed";

  const run = async (hostKey?: string, replace?: boolean) => {
    setError(null);
    setRunning(true);
    try {
      const res = await agentsApi.installRemote(asset.id, { benchmark_id: activeBenchmark, allow_remediation: remediation, host_key: hostKey ?? "", replace_host_key: !!replace });
      setResult(res);
      if (res.status === "installed") onInstalled();
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : az ? "Quraşdırma alınmadı." : "Installation failed.");
    } finally {
      setRunning(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (awaitingKey && result?.host_key) run(result.host_key, result.host_key_changed);
    else run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-lg font-semibold">{az ? "Agenti qur" : "Install agent"}: {asset.name}</h2>
          <p className="mt-1 text-xs text-slate-400">
            {az
              ? `Core saxlanılan etimad məlumatı ilə ${asset.host} ünvanına SSH ilə bir dəfə daxil olur və agenti qurur. Skan və möhkəmləndirmə bundan sonra agent vasitəsilə icra olunur.`
              : `Core signs in to ${asset.host} over SSH once with the stored credential and installs the agent. Scans and hardening then run through the agent.`}
          </p>
          {asset.os_type === "windows" && (
            <p className="mt-1 text-xs text-slate-400">
              {az ? "Windows hostunda OpenSSH server aktiv olmalıdır. RDP əmr icra edə bilmir və yalnız interaktiv sessiya üçündür." : "The Windows host needs the OpenSSH server enabled. RDP cannot run commands and is used for interactive sessions only."}
            </p>
          )}
        </div>

        {info.data && !ready && (
          <p role="alert" className="rounded-md bg-amber-950/50 px-3 py-2 text-sm text-amber-300">
            {!binaryReady
              ? az ? "Bu OS üçün agent faylı və SHA256SUMS yükləmə qovluğunda yoxdur." : "The agent binary for this OS and SHA256SUMS are not published in the downloads directory."
              : az ? "Uzaqdan quraşdırma üçün hostun çata bildiyi HTTPS PUBLIC_ORIGIN lazımdır." : "Remote installation needs an HTTPS PUBLIC_ORIGIN that the host can reach."}
          </p>
        )}

        {!installed && (
          <>
            <label className="block text-sm">
              <span className="text-slate-300">Benchmark</span>
              <select required className={field} value={activeBenchmark} disabled={running || awaitingKey} onChange={(e) => setBenchmarkId(e.target.value)}>
                <option value="" disabled>{az ? "Benchmark seçin" : "Select benchmark"}</option>
                {eligible.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="flex items-start gap-2 text-sm text-slate-300">
              <input type="checkbox" className="mt-1" checked={remediation} disabled={running || awaitingKey} onChange={(e) => setRemediation(e.target.checked)} />
              <span>
                {az ? "Bu agentdə təsdiqlənmiş möhkəmləndirməyə icazə ver" : "Allow confirmed hardening on this agent"}
                <span className="block text-xs text-slate-500">{az ? "İşarələnməsə agent yalnız skan edir." : "Left unticked, the agent only scans."}</span>
              </span>
            </label>
          </>
        )}

        {awaitingKey && (
          <div className="space-y-1 rounded-md border border-amber-800 bg-slate-950 p-3 text-sm">
            <p className={result?.host_key_changed ? "text-red-300" : "text-amber-300"}>
              {result?.host_key_changed
                ? az ? "Bu hostun SSH açarı əvvəl təsdiqlənmiş açardan fərqlidir. Yalnız host yenidən qurulubsa davam edin." : "The SSH host key differs from the key confirmed earlier. Continue only if the host was reinstalled."
                : az ? "Etimad məlumatı göndərilməzdən əvvəl hostun SSH açarını təsdiqləyin." : "Confirm the SSH host key before the credential is sent."}
            </p>
            <code className="block break-all select-all rounded border border-slate-800 bg-slate-900 p-2 font-mono text-xs">{result?.host_key_type} {result?.host_key}</code>
          </div>
        )}

        {result?.status === "failed" && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{result.detail}</p>}
        {installed && <p className="rounded-md bg-emerald-950/50 px-3 py-2 text-sm text-emerald-300">{az ? "Agent quruldu. Qeydiyyatdan keçən kimi host onlayn görünəcək." : "Agent installed. The host shows as online once it has enrolled."}</p>}
        {result?.output && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-400">{result.output}</pre>}
        {error && <p role="alert" className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</p>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800">
            {installed ? (az ? "Bağla" : "Close") : t("common.cancel")}
          </button>
          {!installed && (
            <button type="submit" disabled={running || !ready || !activeBenchmark} className="rounded-md bg-cyan-600 px-4 py-2 font-medium text-white hover:bg-cyan-500 disabled:opacity-50">
              {running ? (az ? "Qurulur..." : "Installing...") : awaitingKey ? (az ? "Təsdiqlə və qur" : "Confirm and install") : az ? "Qur" : "Install"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
