import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "../agentsApi";
import { useI18n } from "../i18n";
import { dateTime } from "../time";

const LEVEL_STYLE: Record<string, string> = {
  info: "text-slate-300",
  warn: "text-amber-300",
  error: "text-red-300",
};

/** Operational log lines the agent shipped to core (status text only, no scan evidence). */
export default function AgentLogs({ agentId, tall = false }: { agentId: string; tall?: boolean }) {
  const { lang } = useI18n();
  const az = lang === "az";
  const [level, setLevel] = useState("");
  const logs = useQuery({
    queryKey: ["agent-logs", agentId, level],
    queryFn: () => agentsApi.logs(agentId, level),
    refetchInterval: 10_000,
  });
  return (
    <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950 p-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">{az ? "Səviyyə" : "Level"}</span>
        <select className="rounded border border-slate-700 bg-slate-900 px-2 py-1" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">{az ? "Hamısı" : "All"}</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
      </div>
      {logs.error && <p className="text-xs text-red-300">{(logs.error as Error).message}</p>}
      {logs.data?.length === 0 && <p className="text-xs text-slate-500">{az ? "Hələ log yoxdur." : "No log entries yet."}</p>}
      <ul className={`${tall ? "max-h-[60vh]" : "max-h-72"} space-y-1 overflow-y-auto font-mono text-xs`}>
        {logs.data?.map((l) => (
          <li key={l.id} className={LEVEL_STYLE[l.level]}>
            <span className="text-slate-500">{dateTime(l.logged_at)}</span> [{l.level}] {l.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
