# Session authorization and termination

Run exactly one tunnel instance for the compose deployment. The core addresses it as `guac-tunnel:8080`; the tunnel addresses the core as `backend:8000`. Both need the same `GUAC_CONTROL_KEY` containing 32 to 512 bytes. Only the tunnel and core receive this key. `GUAC_CRYPT_KEY` is a separate, exactly 32-byte connection-envelope encryption key.

Before WebSocket upgrade, the tunnel hashes the exact presented encrypted token and calls `POST /internal/guac/authorize` on the core with `{token_hash}` and the `X-Guac-Control-Key` header. The core locks the durable session document, verifies ownership/account eligibility, token and session expiry, revocation and single-use status, then consumes the token. Modified CBC envelopes fail this lookup before the library decrypts or opens guacd.

An issued token can open one connection within one minute. The connection expires after one hour. Every 15 seconds the tunnel rechecks `GET /internal/guac/sessions/{id}`; any failed check disconnects the session. If the check times out, the request timeout adds at most five seconds. The hard expiry timer runs locally as well. A browser reload requires issuing a new session.

Ending a session first revokes its durable authorization, then the core calls authenticated `POST /internal/end/{id}` on the tunnel. The tunnel closes the matching guacamole client and WebSocket and confirms closure before the core records a successful end. Temporary tombstones prevent an in-flight authorization response from reopening an ended session. Failed confirmations return HTTP 503 with an explicit distinction between revoked access and unconfirmed termination. Disconnect notifications use `POST /internal/guac/sessions/{id}/closed`.

The shared internal endpoints must stay private. The gateway does not route the core's `/internal/` prefix. The tunnel's HTTP control path still requires its shared key even if reached through `/guac/`; clients never receive the key. Control calls use fixed service addresses, do not follow redirects and never send host credentials. Bridge failure closes its sockets; core failure causes existing sessions to disconnect at the next failed status check.

The dependency's settings callback cannot safely pause connection creation: its constructor invokes the callback while the server subsequently calls `connect()` without awaiting it. Authorization therefore uses the asynchronous `verifyClient` WebSocket upgrade hook, which is passed through by the library's server options. Source inspected without installation or execution:

- [guacamole-lite 1.2.0 npm source archive](https://registry.npmjs.org/guacamole-lite/-/guacamole-lite-1.2.0.tgz)
- [guacamole-lite server source](https://raw.githubusercontent.com/vadimpronin/guacamole-lite/v1.2.0/lib/Server.js)
- [ws 8.15.1 upgrade verification source](https://raw.githubusercontent.com/websockets/ws/8.15.1/lib/websocket-server.js)

No build, runtime or connection tests were run, as requested.
