// All URLs are relative (/api/...) so the app works from any IP the gateway is reached on.

const TOKEN_KEY = "hardenops.tokens";

export interface Tokens {
  access_token: string;
  refresh_token: string;
  must_change_password: boolean;
}

export interface User {
  id: number;
  username: string;
  role: "admin" | "operator" | "viewer" | string;
  must_change_password: boolean;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Per-browser convenience only. Failure to read/write storage must never break the app.
function readStoredTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

let tokens: Tokens | null = readStoredTokens();
let sessionGeneration = 0;

export function getTokens(): Tokens | null {
  return tokens;
}

export function setTokens(next: Tokens | null): void {
  sessionGeneration++;
  storeTokens(next);
}

function storeTokens(next: Tokens | null): void {
  tokens = next;
  try {
    if (next) localStorage.setItem(TOKEN_KEY, JSON.stringify(next));
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private window): keep tokens in memory only */
  }
}

let refreshFlight: { session: Tokens; promise: Promise<boolean> } | null = null;

function refreshTokens(): Promise<boolean> {
  const session = tokens;
  if (!session) return Promise.resolve(false);
  if (refreshFlight?.session === session) return refreshFlight.promise;
  const promise = (async () => {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) return false;
    const next = (await res.json()) as Tokens;
    if (tokens !== session) return false;
    storeTokens(next);
    return true;
  })().finally(() => {
    if (refreshFlight?.promise === promise) refreshFlight = null;
  });
  refreshFlight = { session, promise };
  return promise;
}

async function fetchResponse(path: string, init: RequestInit = {}, auth = true, retried = false): Promise<Response> {
  const accessToken = tokens?.access_token;
  const generation = sessionGeneration;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (auth && accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  const res = await fetch(`/api${path}`, { ...init, headers });

  if (res.status === 401 && auth && !retried && tokens && generation === sessionGeneration &&
      (tokens.access_token !== accessToken || await refreshTokens()) && generation === sessionGeneration && tokens) {
    return fetchResponse(path, init, auth, true);
  }
  return res;
}

export async function request<T>(path: string, init: RequestInit = {}, auth = true, retried = false): Promise<T> {
  const res = await fetchResponse(path, init, auth, retried);
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches a protected binary (e.g. a session recording) and returns a blob: URL for the browser to play. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await fetchResponse(path);
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? "No recording for this session" : `HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

export const api = {
  login: (username: string, password: string) =>
    request<Tokens>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }, false),
  me: () => request<User>("/auth/me"),
  changePassword: (current_password: string, new_password: string) =>
    request<void>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),
  health: () => request<{ status: string }>("/health", {}, false),
  attack: (benchmarkId: string) =>
    request<{
      techniques: { id: string; name: string; controls: string[]; before: number | null; after: number | null }[];
      total: number;
      mitigated_before: number;
      mitigated_after: number;
      threshold: number;
      hosts_assessed: number;
    }>(`/attack/coverage?benchmark_id=${encodeURIComponent(benchmarkId)}`),
  ready: () => request<{ status: string; database: string }>("/health/ready", {}, false),
};
