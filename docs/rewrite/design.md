# Wearden Go rewrite design

Status: implementation authorized by continued user instruction, 2026-11-15. First native scanning milestone implemented; full rewrite remains in progress. See progress.md for verified scope.

## Intent and authority

Replace the legacy Python backend and build native Go agents in the six existing sibling repositories. Preserve useful content and UI rather than translating everything mechanically. The user's latest instruction supersedes the earlier brief's Python-only core and import-before-rewrite sequence. JSON Schema is the user's chosen agent contract format. Existing functionality is a parity target, not permission to remove hard features.

## Observed baseline

The local prototype contains 57 router declarations, 15 database model classes, 16 React page files, and 51 benchmark YAML files. `legacy-inventory.json` records the exact paths, handlers and source line numbers from Python AST parsing. This is an inventory, not a claim that every endpoint works or that all call paths have been read. Initial inspection covered authentication, frontend request handling, benchmark loading/schema, scan evaluation/scoring, scheduling, hardening orchestration, credential encryption, Guacamole tokens and the AI request boundary. Remaining functions must be read before their implementation task.

Core dependencies observed:

- React pages -> typed TypeScript API clients -> REST routers -> database/domain services.
- Scans -> benchmark loader/profiles -> SSH/WinRM target execution -> evaluator -> scores -> database/events.
- Hardening/drift/rollback -> scan target helpers + backup/restore scripts + stored credentials.
- Sessions -> credential vault -> encrypted Guacamole token -> Node tunnel -> guacd -> recording storage.
- AI copilot -> benchmark text and aggregate scores -> optional external AI service; static fallback without a key.

## Repository ownership

| Repo | Final content | Reuse decision |
| --- | --- | --- |
| core | Go API, PostgreSQL migrations, Go worker, adapted React frontend, deployment/dev tooling | Keep React/TS/Tailwind and compatible nginx configuration. Keep Node guac-tunnel and guacd as an optional integration; rewriting a working protocol bridge brings no immediate benefit. |
| agent-linux | Native Go Linux agent and container fixture | Reimplement local inspection semantics; no SSH scanning dependency. |
| agent-windows | Native Go Windows service/CLI and native checks | Reimplement Windows inspection, registry/policy/service access. |
| ruleset | Existing Linux/Windows benchmark YAML, schema documentation | Copy content without changing IDs, expected values, remediation text or profiles. |
| proto | Versioned JSON Schema requests/responses, HTTP contract, fixtures and shared Go wire types | New contract, separate from legacy browser API. |
| .github | Organization profile and repository guidance | Retain existing org content; no application code. |

Every folder remains an independent Git repository. No parent Git repository, committed go.work, or cross-repo source copies. Local Go module replacements may be uncommitted development configuration; published modules use versioned dependencies.

## Proposed technical choices made by the agent

These are proposed choices, not preferences attributed to the user:

- Go standard-library HTTP routing and JSON; PostgreSQL remains the persistent store. Use a supported PostgreSQL Go driver and established crypto/YAML/schema libraries after source/dependency review, rather than implementing cryptography or YAML parsing.
- Go worker with durable database jobs, transactionally claimed and leased, replaces Celery. At-least-once delivery with idempotent effects; bounded retries, cancellation and restart recovery. Redis remains only where the final event fan-out design requires it; do not add another queue service.
- Preserve browser-facing endpoint shapes where practical to reuse React. Document intentional changes and update their TypeScript callers together. Never return fake successful empty data for unimplemented endpoints.
- New agent endpoints are versioned REST+JSON with JSON Schema Draft 2020-12. An HTTP contract document also specifies methods, auth, errors, retries and status codes; schemas alone do not describe transport.
- Go API and both agents target amd64 builds. The installed Go executable currently reports windows/386; cross-build verification must explicitly set GOOS/GOARCH. Linux integration requires a real Linux/container environment, Windows integration requires an isolated Windows lab.
- Start with a fresh PostgreSQL schema for the rewrite. Preserve the prototype database and files. Historical database import is not part of this rewrite unless separately requested; no automatic destructive migration or legacy credential decryption.

## Behavior that must survive

### Identity, assets and audit

Preserve viewer/operator/admin authorization, inactive-user rejection, forced password change, access/refresh token distinction, expiry and login throttling. Use password hashing from an established library. Persist assets and append audit events for security-relevant operations. Agent credentials and user credentials are separate trust domains. A heartbeat must never confer authority to submit for another agent.

### Agent contract and scheduling

Enrollment uses a scoped expiring enrollment token and returns a unique agent identity and credential once. Store only verifiable hashes of agent/enrollment secrets; support revocation. Subsequent requests authenticate an agent and bind every submitted identity to that principal. Require TLS outside loopback development. Config includes benchmark/profile selection, ruleset version/content digest and scan interval. Fetch config/ruleset using authenticated endpoints; reject content/version mismatches before a scan.

Each report carries a stable report ID, agent ID, benchmark/profile, ruleset version, start/end times, structured findings and advisory scores. Validate all rule IDs/statuses/severities and evidence limits. Core recomputes authoritative scores from the assigned ruleset; agent input cannot redefine severity. Persist report acceptance atomically and deduplicate retries by agent/report ID. Persist unsent reports locally with restricted permissions and bounded storage, retry with backoff, and remove them only after a successful matching acknowledgement. Heartbeats and report retries must not launch overlapping scans. Offline agents report stale status honestly.

A dashboard scan request becomes an agent job, not a core-initiated SSH action. Agents fetch assigned jobs/config and acknowledge results. Cancellation is cooperative and must retain partial evidence. Recurring schedules use durable timestamps and do not start duplicate active jobs after restarts.

### Checks and scores

Keep pass/fail/error/not_applicable separate. Reuse the legacy evaluator's observable semantics, including missing sysctl values being not_applicable, numeric comparisons using the final nonempty line, and invalid patterns returning errors. Check native Go regex compatibility rule by rule; unsupported syntax must be explicit, never silently changed. Errors and not-applicable results are excluded from denominators. Unweighted score is pass/(pass+fail)*100, rounded to one decimal; severity weights are low=1, medium=2, high=3, critical=4. No scored results means null, not 100. Characterize Python rounding behavior before selecting the Go rounding implementation.

Implement native checks by stable control ID with explicit rule coverage. YAML command strings are reference content, not an agent remote-shell API. Unsupported rules produce explicit results and remain visible in the coverage inventory. Reusing YAML does not imply every check is executable by the Go agents. Start with Linux filesystem controls; extend through all Linux categories, then Windows categories. Never run remediation during inspection.

### Remaining feature parity

Port dashboard/host analytics, benchmark/profile views, scan progress, history/diffs, audit views, schedules, score-drop alerts, attack coverage and CSV/JSON/PDF reports. PDF generation uses an established renderer/library after review, with a test of output content. Webhooks require bounded timeouts and SSRF controls, and are tested with local stubs only.

Port AI explain/summary behavior and static fallback to Go. Tests use mocked HTTP transport; do not send local files, identifiers, evidence or secrets to AI services. Keep model configurable rather than asserting the prototype model string is currently valid.

Preserve session opening/ending, recordings, authorized playback and Guacamole bridge interoperability. Sessions remain independent of agent scanning and optional in deployment. Session target credentials, recordings and tokens remain confidential. Reuse the bridge's supported token format with a compatibility test; do not invent replacement encryption.

Hardening, rollback and drift are later parity milestones, not omitted features. Their existing implementation is tightly coupled to remote execution and cannot simply be copied into a Go agent design. Build typed agent actions only after read-only scanning is proven. Preserve backup-before-change, risk confirmation, local watchdog recovery across lost core connectivity, explicit cancellation, backup protection and verified restoration. Never expose arbitrary shell command execution through the agent contract. Unknown/unsupported changes fail closed. Test actions in disposable lab fixtures only. Optional legacy agentless support remains a future option; the old code remains intact as a reference, with no new agentless execution path in the Go product.

## Delivery sequence and acceptance

1. Capture precise legacy request/response and behavior fixtures, inventory coverage, safely copy benchmark content and React assets. Exclude real .env, credentials, databases, recordings, node_modules, virtualenvs and caches.
2. Define/test agent JSON Schemas and transport semantics. Create Go core identity, migrations, benchmark loading and authenticated agent ingestion. Test authorization failures, malformed input, duplicate submissions, transactional persistence and score parity.
3. Build Linux scanning/reporting/config/caching and a container integration fixture. Demonstrate enrollment -> checks -> persisted report -> real React dashboard. Test restart/offline recovery and unsupported rules explicitly.
4. Complete remaining Linux categories and build Windows equivalent with per-rule fixtures and native OS integration. Cross-compilation alone does not prove native checks work.
5. Complete browser API parity, schedules/jobs, analytics, exports, audit, AI fallback and session recording. Tests cover access controls on every protected resource and WebSocket connection.
6. Implement and prove agent hardening/rollback/drift in isolated fixtures, including interrupted changes and recovery after process restart. Record intentional differences from prototype behavior.
7. Verify deployment, update operational docs and complete the endpoint/page/control parity ledger. Separate commits per repository; no push without instruction. No claim of full rewrite until all selected features have evidence.

Each milestone includes unit tests, relevant integration tests and repository build checks. Reuse assertions/data from Python tests as behavioral fixtures rather than carrying a Python runtime into the final core. Keep a visible parity ledger with not-started/implemented/verified/blocked status, source reference and verification command. A stub is not verified.

## Constraints and current limitations

Legacy source and real secrets remain untouched. Rotate the legacy development secrets before non-disposable usage, as already reported. No destructive operations, history rewriting, global package installation, production scans or live external AI/webhook calls. Dependencies require the user's source-review policy before installation. Docker and Make were not available in the checked environment; installed Python lacks pytest. Do not describe compose, legacy tests, Linux checks or full deployment as passing until actually run.

## Approval boundary

The user has authorized the rewrite scope and reuse choices. This document makes the otherwise unresolved architectural choices reviewable before product scaffolding and dependency installation. Following review, write the detailed implementation plan with exact per-repo interfaces, tests and milestones. The design is not an implementation and is not evidence of feature completion.
