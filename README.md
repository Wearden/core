# Wearden core

Go central API and durable PostgreSQL backend. The React dashboard and optional Guacamole bridge are reused from the prototype. Original prototype files are untouched. This rewrite is still in progress; consult `docs/rewrite/progress.md` for incomplete features. No tests or live OS scans are run after the user's explicit no-test instruction.

## Implemented source

- PostgreSQL schema/bootstrap and bounded connection pool.
- Argon2id administrator authentication, opaque hashed access/rotating refresh tokens, roles, forced initial password change and login throttling.
- Asset inventory and AES-GCM encrypted optional SSH/RDP credentials.
- Scoped single-use agent enrollment, hashed agent credentials, revocation, heartbeat, native assignment/digest delivery.
- Durable scan jobs and atomic/idempotent report ingestion with authoritative rule coverage/severity checks.
- Existing benchmark/profile, scan/results, analytics, audit, copilot and CSV/JSON report API shapes.
- React agent enrollment/revocation UI; Node Guacamole bridge remains optional.

Agent inspection is local Go code. Core never executes YAML audit/remediation command strings. Legacy benchmark IDs can select a compatible native agent's matching rule IDs; unsupported checks remain visible as errors, not successful coverage. Native and original baselines are listed separately.

## Local layout and Go workspace

Clone all six repositories as siblings. Do not initialize a parent Git repository. From their parent folder, if no workspace exists:

```powershell
go work init ./proto ./core ./agent-linux ./agent-windows
go work edit '-replace=github.com/Wearden/proto@v0.0.0=./proto'
go work sync
```

The v0.0.0 requirement is a local bootstrap placeholder until proto is tagged and published. go.work is local configuration, not a monorepo. Dependencies are pinned in go.mod/go.sum. No global tool installation is required.

## Isolated local deployment

1. Make a local `.env` using `.env.example` as a template, then replace every placeholder. Real `.env` files must never be committed.
2. Set independent random POSTGRES_PASSWORD and ADMIN_PASSWORD (at least 12 bytes). Configure WEARDEN_VAULT_KEY as base64 of 32 random bytes if optional credentials will be stored. It is not the prototype Fernet key.
3. Leave ANTHROPIC_API_KEY/MODEL empty to use static explanations. A nonempty model is an operator-selected model identifier, not a guarantee that an old prototype model is available.
4. Keep `RULESET_PATH=../ruleset`, or point it to the sibling checkout. Compose mounts it read-only inside core.
5. Run `docker compose up --build -d` from core when Docker is available. This has not been executed in this session. The local gateway binds only `127.0.0.1:8080`.
6. Sign in with configured admin credentials and change the initial password. Create a token for a native benchmark in Assets; use the matching OS agent's daemon instructions.

For optional remote sessions, set independent GUAC_CRYPT_KEY (32 ASCII bytes) and GUAC_CONTROL_KEY (a long random control secret), then enable the compose `sessions` profile. TLS is mandatory before exposing the gateway beyond a disposable local lab. The current compose file supplies isolated plain HTTP only on loopback.

Outside compose, supply DATABASE_URL with explicit URL-encoded user/password or the individual DATABASE_HOST/PORT/NAME/USER/PASSWORD settings. TLS defaults to verify-full; only explicit sslmode=disable is allowed for an isolated local database. Automatic PostgreSQL service/password/client-certificate file discovery is disabled; no old credentials are imported. Run from core with RULESET_PATH pointing to the sibling ruleset. LISTEN_ADDR defaults to loopback.

Do not run destructive reset/down-volume commands to apply schema changes. Migration startup only creates the new schema; it never imports or drops the legacy database. Historical data migration is a separate explicitly authorized operation.

## Native hardening and rollback

Hardening plans are reviewed by the operator before queueing. Core sends typed apply/rollback tasks with known control IDs only. Each agent is scan-only by default; start its daemon with `-allow-remediation` to opt into its reviewed mutation allowlist. Unsupported controls are rejected before queueing, and agent checks remain the final boundary. Never treat this as an arbitrary shell executor.

Linux currently supports27 narrow configuration/metadata actions; Windows supports56 actions (31 DWORD registry corrections,7 local account-policy scalars and18 audit-policy subcategories). See each agent's capability document for exact IDs. Independent recovery helpers are implemented for both platforms. NET002..008 and the expanded Windows authentication/session policy actions require risk confirmation. SSH/PAM content, IP forwarding and firewall writes remain outside the current typed write/restore allowlists. Backup restoration, crash recovery and report replay are implemented, but source compilation does not establish runtime safety. Original backup contents remain private on the agent and are not uploaded.

Drift events are derived from subsequent agent reports against applied-change baselines. A manual drift refresh queues real scans. Rollback withdraws the corresponding baseline and resolves its active drift notification. Cancellation stops future queued work; an already fetched task may finish and its late result remains auditable.

## Build artifacts and disposable fixture

`./scripts/build.ps1` compiles Linux/Windows amd64 binaries into a new ignored core/bin folder, writes SHA-256 metadata and copies distribution notices. It does not run tests, start services or execute agents. The module workspace is required until the shared proto module is released.

The optional `docker-compose.lab.yml` defines a disposable Ubuntu agent container with no host filesystem mounts. It shares the backend network namespace only to use literal loopback HTTP in an isolated fixture. It observes container configuration, never an attested host view. Create a native Linux enrollment token and supply it privately as WEARDEN_ENROLLMENT_TOKEN before explicitly starting the `agent-lab` profile. The fixture is scan-only and is not launched automatically.

The local frontend node_modules junction reuses dependencies from the original development folder and is Git-ignored. TypeScript and Vite production compilation passed; generated dist output is also ignored. No tests or live application/OS checks were run after the no-test instruction.

## Operating guides and retained legacy fixture

See docs/DEMO_SCRIPT.md for the agent-based walkthrough and docs/TARGETS.md for exact supported OS scope. The optional Makefile wraps source compilation and ordinary compose operations; the PowerShell build script remains the Windows distribution path. No make or system package was installed.

The old Ubuntu22.04 SSH target source is retained separately under lab/ubuntu-target, with an explicit disposable password required instead of a built-in fallback. It is excluded from default compose and cannot satisfy the Ubuntu24.04 native assignment. Use lab/agent-linux for the new model. Neither fixture was built or started here.
