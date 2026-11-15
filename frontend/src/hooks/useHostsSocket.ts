import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getTokens } from "../api";
import type { Asset, HostStatusUpdate } from "../types";

interface HostsMessage {
  type: "hosts";
  hosts: HostStatusUpdate[];
}

function mergeStatus(old: Asset[] | undefined, updates: HostStatusUpdate[]): Asset[] | undefined {
  if (!old) return old;
  const byId = new Map(updates.map((u) => [u.id, u]));
  return old.map((a) => {
    const u = byId.get(a.id);
    return u ? { ...a, status: u.status, latency_ms: u.latency_ms, last_seen: u.last_seen, last_checked: u.last_checked } : a;
  });
}

/**
 * Subscribes to /ws/hosts and writes every health tick into the ["assets"] query cache.
 * Reconnects after 3 s; stops retrying when the server rejects the token (close code 1008).
 */
export function useHostsSocket(): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let disposed = false;

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/ws/hosts`);

      socket.onopen = () => {
        socket?.send(JSON.stringify({ type: "auth", token: getTokens()?.access_token ?? "" }));
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as HostsMessage;
        if (msg.type !== "hosts") return;
        setConnected(true);
        queryClient.setQueryData<Asset[]>(["assets"], (old) => mergeStatus(old, msg.hosts));
      };
      socket.onclose = (event) => {
        setConnected(false);
        if (!disposed && event.code !== 1008) {
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [queryClient]);

  return { connected };
}
