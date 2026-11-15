import { request } from "./api";
import type {
  Asset,
  AssetInput,
  AuditRow,
  CredentialInput,
  HistorySample,
  TestResult,
} from "./types";

export const assetsApi = {
  list: () => request<Asset[]>("/assets"),
  create: (body: AssetInput) => request<Asset>("/assets", { method: "POST", body: JSON.stringify(body) }),
  update: (id: number, body: AssetInput) =>
    request<Asset>(`/assets/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: number) => request<void>(`/assets/${id}`, { method: "DELETE" }),
  setCredential: (id: number, body: CredentialInput) =>
    request<void>(`/assets/${id}/credential`, { method: "PUT", body: JSON.stringify(body) }),
  clearCredential: (id: number) => request<void>(`/assets/${id}/credential`, { method: "DELETE" }),
  test: (id: number) => request<TestResult>(`/assets/${id}/test`, { method: "POST" }),
  history: (id: number, limit = 60) => request<HistorySample[]>(`/assets/${id}/history?limit=${limit}`),
  audit: (limit = 200) => request<AuditRow[]>(`/audit?limit=${limit}`),
};
