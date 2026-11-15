// The core approves exact, single-use token hashes before any guacd connection opens.
const GuacamoleLite = require("guacamole-lite");
const http = require("http");
const crypto = require("crypto");

const port = Number(process.env.TUNNEL_PORT || 8080);
const cryptKey = process.env.GUAC_CRYPT_KEY || "";
const controlKey = process.env.GUAC_CONTROL_KEY || "";
if (Buffer.byteLength(cryptKey) !== 32 || Buffer.byteLength(controlKey) < 32 || Buffer.byteLength(controlKey) > 512) {
  console.error("GUAC_CRYPT_KEY must be 32 bytes and GUAC_CONTROL_KEY must contain 32..512 bytes.");
  process.exit(1);
}

const sessions = new Map();
const requests = new WeakMap();
const revokedUntil = new Map();
const idPattern = /^[a-f0-9]{32}$/;
const keyHash = crypto.createHash("sha256").update(controlKey).digest();
let pendingAuthorizations = 0;
let bridge;

// Fixed internal origin and no redirects: the browser cannot choose an authorization target.
function coreRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const request = http.request({ hostname: "backend", port: 8000, path: `/internal/guac${path}`, method,
      headers: { "X-Guac-Control-Key": controlKey, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }, timeout: 5000,
    }, (response) => {
      let result = "";
      response.on("data", (chunk) => { result += chunk; if (result.length > 4096) response.destroy(new Error("Control response too large")); });
      response.on("error", reject);
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error("Session authorization denied"));
        try { resolve(result ? JSON.parse(result) : {}); } catch { reject(new Error("Invalid control response")); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Control timeout")));
    request.on("error", reject);
    request.end(payload);
  });
}

function notifyClosed(id) {
  coreRequest("POST", `/sessions/${id}/closed`, {}).catch(() => console.error("Session closure notification unavailable."));
}

function stopSession(id) {
  // Cover authorization responses racing with a core-initiated end request.
  revokedUntil.set(id, Date.now() + 61 * 60 * 1000);
  const entry = sessions.get(id);
  if (!entry) return Promise.resolve(true);
  entry.closed = true;
  clearTimeout(entry.expiryTimer);
  clearTimeout(entry.checkTimer);
  sessions.delete(id);
  for (const client of bridge.activeConnections.values()) {
    if (client.webSocket === entry.socket) client.close();
  }
  if (!entry.socket) {
    entry.request.socket.destroy();
    notifyClosed(id);
    return Promise.resolve(true);
  }
  // A WebSocket close drives ClientConnection.close(), which destroys its guacd socket.
  // Wait for that event before acknowledging actual transport termination to the core.
  return new Promise((resolve) => {
    if (entry.socket.readyState === entry.socket.CLOSED) { notifyClosed(id); resolve(true); return; }
    const timer = setTimeout(() => { console.error("Tunnel termination was not confirmed."); resolve(false); }, 1500);
    entry.socket.once("close", () => { clearTimeout(timer); notifyClosed(id); resolve(true); });
    entry.socket.terminate();
  });
}

function monitor(entry) {
  entry.checkTimer = setTimeout(async () => {
    if (entry.closed) return;
    try {
      await coreRequest("GET", `/sessions/${entry.id}`);
      if (!entry.closed) monitor(entry);
    } catch { stopSession(entry.id); }
  }, 15000);
  entry.checkTimer.unref();
}

function verifyClient(info, done) {
  if (sessions.size + pendingAuthorizations >= 100) return done(false, 503, "Tunnel capacity reached");
  let token;
  try {
    if (info.req.url.length > 65536) throw new Error("Invalid URL");
    const url = new URL(info.req.url, "http://bridge");
    const keys = [...url.searchParams.keys()];
    token = url.searchParams.get("token");
    if (url.pathname !== "/" || keys.length !== 1 || keys[0] !== "token" || !token || token.length > 48000) throw new Error("Invalid token");
  } catch { return done(false, 403, "Invalid session token"); }
  pendingAuthorizations += 1;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  coreRequest("POST", "/authorize", { token_hash: tokenHash }).then((approved) => {
    pendingAuthorizations -= 1;
    const expires = Date.parse(approved.expires_at);
    if (!idPattern.test(approved.id) || !Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 61 * 60 * 1000 || revokedUntil.has(approved.id) || sessions.has(approved.id)) {
      return done(false, 403, "Session expired or revoked");
    }
    if (info.req.socket.destroyed) { notifyClosed(approved.id); return; }
    const entry = { id: approved.id, request: info.req, socket: null, closed: false, checkTimer: null, expiryTimer: null };
    sessions.set(entry.id, entry);
    requests.set(info.req, entry);
    entry.expiryTimer = setTimeout(() => stopSession(entry.id), expires - Date.now());
    entry.expiryTimer.unref();
    monitor(entry);
    done(true);
  }, () => { pendingAuthorizations -= 1; done(false, 403, "Session authorization unavailable"); });
}

const server = http.createServer({ maxHeaderSize: 65536 }, async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "GET" && request.url === "/healthz") { response.writeHead(200); response.end("ok\n"); return; }
  const match = /^\/internal\/end\/([a-f0-9]{32})$/.exec(request.url);
  const presented = request.headers["x-guac-control-key"];
  const authenticated = typeof presented === "string" && presented.length <= 512 && crypto.timingSafeEqual(keyHash, crypto.createHash("sha256").update(presented).digest());
  if (request.method !== "POST" || !match || !authenticated) { response.writeHead(403); response.end(); return; }
  const terminated = await stopSession(match[1]);
  response.writeHead(terminated ? 200 : 503, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ terminated }));
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;

// guacamole-lite 1.2.0 forwards these options to ws.WebSocketServer. Its settings
// callback is not await-safe, so authorization must happen at the upgrade boundary.
bridge = new GuacamoleLite({ server, verifyClient, maxPayload: 1024 * 1024, perMessageDeflate: false }, {
  host: process.env.GUACD_HOST || "guacd", port: Number(process.env.GUACD_PORT || 4822),
}, {
  crypt: { cypher: "AES-256-CBC", key: cryptKey },
  log: { level: "ERRORS", stdLog: () => {}, errorLog: () => console.error("Remote tunnel connection failed.") },
  maxInactivityTime: 10 * 60 * 1000,
});
bridge.webSocketServer.on("connection", (socket, request) => {
  const entry = requests.get(request);
  if (!entry || entry.closed) { socket.terminate(); return; }
  entry.socket = socket;
  socket.on("error", () => stopSession(entry.id));
});
bridge.on("close", (client) => {
  for (const entry of sessions.values()) {
    if (entry.socket === client.webSocket) { stopSession(entry.id); break; }
  }
});
setInterval(() => { for (const [id, until] of revokedUntil) { if (until <= Date.now()) revokedUntil.delete(id); } }, 60000).unref();
server.on("error", () => { console.error("Tunnel HTTP server failed."); process.exit(1); });
server.listen(port, "0.0.0.0", () => console.log(`Wearden tunnel listening on :${port}`));
function shutdown() {
  for (const id of sessions.keys()) stopSession(id);
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
