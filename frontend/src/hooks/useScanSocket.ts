import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTokens } from "../api";
import type { ScanDetail } from "../scansApi";

export interface LiveCheck {
  key: string;
  hostId: number;
  hostName: string;
  controlId: string;
  title: string;
  status: string;
  actual: string | null;
  expected: string;
  durationMs: number;
}

type Msg = Record<string, any>;

/**
 * Subscribes to /ws/scans/:id. Snapshot and host/scan events update the ["scan", id] cache;
 * check events append to a live feed kept in component state (last 300 lines).
 */
export function useScanSocket(scanId: string | undefined): { connected: boolean; feed: LiveCheck[] } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<LiveCheck[]>([]);

  useEffect(() => {
    if (!scanId) return;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let disposed = false;
    let counter = 0;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/ws/scans/${scanId}`);
      socket.onopen = () => socket?.send(JSON.stringify({ type: "auth", token: getTokens()?.access_token ?? "" }));
      socket.onclose = (event) => {
        setConnected(false);
        if (!disposed && event.code !== 1008) retry = window.setTimeout(connect, 3000);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as Msg;
        setConnected(true);
        if (msg.type === "snapshot") {
          queryClient.setQueryData<ScanDetail>(["scan", scanId], (old) =>
            old ? { ...old, status: msg.scan.status, done_checks: msg.scan.done } : old,
          );
        } else if (msg.type === "host" || msg.type === "host_started") {
          queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
        } else if (msg.type === "scan") {
          queryClient.setQueryData<ScanDetail>(["scan", scanId], (old) =>
            old ? { ...old, status: msg.status, done_checks: msg.done } : old,
          );
          if (msg.status !== "running") queryClient.invalidateQueries({ queryKey: ["scan", scanId] });
        } else if (msg.type === "check") {
          counter += 1;
          queryClient.setQueryData<ScanDetail>(["scan", scanId], (old) =>
            old ? { ...old, done_checks: msg.done } : old,
          );
          setFeed((lines) => [
            ...lines.slice(-299),
            {
              key: `${counter}`,
              hostId: msg.host_id,
              hostName: msg.asset_name ?? "",
              controlId: msg.control_id,
              title: msg.title,
              status: msg.status,
              actual: msg.actual,
              expected: msg.expected,
              durationMs: msg.duration_ms,
            },
          ]);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socket?.close();
    };
  }, [scanId, queryClient]);

  return { connected, feed };
}
