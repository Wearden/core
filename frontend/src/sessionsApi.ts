import { request } from "./api";
import type { RemoteSessionRow, SessionOpenResult } from "./sessionTypes";

export const sessionsApi = {
  open: (assetId: number, width: number, height: number, certificateFingerprint = "", vaultId = "") =>
    request<SessionOpenResult>("/sessions", {
      method: "POST",
      body: JSON.stringify({ asset_id: assetId, width, height, certificate_fingerprint: certificateFingerprint, vault_id: vaultId }),
    }),
  rdpCertificate: (assetId: number) =>
    request<{ fingerprint: string; subject: string; not_after: string; trusted: boolean; changed: boolean }>(`/assets/${assetId}/rdp-certificate`),
  list: () => request<RemoteSessionRow[]>("/sessions"),
  end: (id: string) => request<RemoteSessionRow>(`/sessions/${id}/end`, { method: "POST" }),
};
