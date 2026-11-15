import { request } from "./api";
import type { RemoteSessionRow, SessionOpenResult } from "./sessionTypes";

export const sessionsApi = {
  open: (assetId: number, width: number, height: number) =>
    request<SessionOpenResult>("/sessions", {
      method: "POST",
      body: JSON.stringify({ asset_id: assetId, width, height }),
    }),
  list: () => request<RemoteSessionRow[]>("/sessions"),
  end: (id: string) => request<RemoteSessionRow>(`/sessions/${id}/end`, { method: "POST" }),
};
