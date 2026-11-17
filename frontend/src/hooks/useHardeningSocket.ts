import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTokens } from "../api";
import { timeOnly } from "../time";

export interface LogLine {
  key: string;
  text: string;
}

/** Live hardening log: every change and rollback event for one run. Refreshes the run query on each event. */
export function useHardeningSocket(runId: string | undefined): { connected: boolean; log: LogLine[] } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);

  useEffect(() => {
    if (!runId) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let disposed = false;
    let counter = 0;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/ws/hardening/${runId}`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: "auth", token: getTokens()?.access_token ?? "" }));
      socket.onclose = (event) => {
        setConnected(false);
        if (!disposed && event.code !== 1008) retry = window.setTimeout(connect, 3000);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as Record<string, any>;
        setConnected(true);
        if (msg.type === "snapshot") return;
        counter += 1;
        let text = "";
        if (msg.type === "change") text = `progress ${msg.done}/${msg.total}`;
        else if (msg.type === "run") text = `run ${msg.status}`;
        else if (msg.type === "rollback") text = `rollback ${msg.control_id} on ${msg.asset_name}: ${msg.status}`;
        else text = `${msg.asset_name} ${msg.control_id}: ${msg.status}${msg.message ? ` (${msg.message})` : ""}`;
        setLog((lines) => [...lines.slice(-299), { key: `${counter}`, text: `${timeOnly()}  ${text}` }]);
        queryClient.invalidateQueries({ queryKey: ["run", runId] });
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socket?.close();
    };
  }, [runId, queryClient]);

  return { connected, log };
}
