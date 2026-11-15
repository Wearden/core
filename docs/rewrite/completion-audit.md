# Completion audit

Source checkpoint: 2026-11-15. The complete rewrite is not yet finished. This audit preserves the original scope instead of treating the implemented subset as the entire goal.

The later user instructions authorize a Go core and complete rewrite, superseding the brief's Python-only core and import-before-rewrite order. JSON Schema is the chosen REST contract. The current instruction explicitly prohibits tests. No tests, live scans, service installation, deployment or application startup were performed for this checkpoint.

## Requirements and evidence

| Requirement | Current authoritative evidence | Boundary or remaining work |
| --- | --- | --- |
| Six sibling repositories, no monorepo | Git roots inspected separately for core, agent-linux, agent-windows, ruleset, proto and .github; parent has no .git | Publishing is not performed |
| Preserve the original project | Implementation resides in the new repositories; legacy source was read/copied selectively | No legacy database or real .env import |
| Preserve benchmark content | All51 original YAML files compared byte-for-byte with ruleset; zero differences or missing files | CIS-style labels remain unverified content |
| Preserve browser route coverage | All57 legacy route declarations mapped to current Go patterns in route-parity.json | Static route mapping does not prove response semantics or runtime compatibility |
| Go core and persistence | core/cmd/core, core/internal/app and core/internal/store; PostgreSQL schema/worker source | Fresh-database bootstrap only; no automatic legacy history import |
| Authentication and roles | auth.go/security.go, role wrappers on user routes, hashed tokens and password-change gate | Source and compiler evidence; no authentication exercise |
| Assets and encrypted credentials | assets.go plus AES-GCM vault source | No real credentials opened, copied or imported |
| Agent contract | proto/wire and11 JSON Schema documents | Go validation is explicit; no third-party schema validator installed |
| Enrollment and retry identity | Request-ID protocol, atomic core enrollment and durable private client pending requests | No enrollment performed |
| Agent scheduling/report delivery | Linux daemon, Windows client/daemon, persistent spools, idempotent ingestion | No report submitted or target contacted |
| Linux inspection | 88-control native manifest,87 connected providers and one explicit manual control; canonical/embedded digest match | Conservative providers can return error; USR006 remains manual |
| Ubuntu22.04 legacy baseline | Matching100-control native assignment,99 connected entries and manual USR006; canonical/embedded bytes match | Twelve additional audit checks inspect package/enablement/loaded-rule selectors only; no runtime validation or audit write handlers |
| Linux platform scope | Supported Ubuntu22.04/24.04 metadata before enrollment; assignment release must match before scans and new task work | Namespace metadata is not whole-host attestation; existing recovery/delivery precedes the guard |
| Windows inspection | Three100-control manifests;98 connected providers and2 manual controls per OS; embedded/canonical bytes match | Complexity/reversible-storage audits remain manual; native availability is unexercised |
| Windows service hosting | Confirmed installer, LocalSystem SCM hosting, protected state/bootstrap, cancellation/restart source | No service installed or started; binary upgrades require separate review |
| Typed remediation and rollback | Core task API,27 Linux handlers and77 Windows handlers; private backups and exact native restores | Full prototype remediation parity remains incomplete |
| Recovery across main-process loss | Independent platform helpers, durable journals, elapsed-time leases and revisioned compensation | No helper or recovery path executed |
| Retain stronger compliant policies | Shared ValidApplyTarget permits the compiled target or unchanged compliant original; agent/helper/journal paths use it | Source mismatch fixed; no runtime reproduction under the no-test instruction |
| Drift | Subsequent report reconciliation against applied baselines; rollback/compensation withdraw baselines | No drift scenario exercised |
| Analytics/ATT&CK/copilot | Go feature handlers and retained React pages/clients | Native response/behavior parity still needs final source review |
| Percentage rounding | Legacy operation order and decimal formatting/parsing path inspected against CPython3.12 and Go source; wire.Score updated | No numerical tests or exhaustive differential run |
| Reports | Bounded JSON/CSV/PDF handlers; CSV formula neutralization; embedded-font PDF source | No PDF rendered or downloaded |
| Optional recorded sessions | Core session routes, bridge controls, guacd profile and recording-access source | No remote session opened; single bridge instance is required |
| Deployment/build artifacts | Dockerfiles, compose files, PowerShell distribution script and Makefile | Compiler checks and PowerShell parsing only; no image build or deployment |
| New and retained lab fixtures | lab/agent-linux is primary; lab/ubuntu-target retains the old Ubuntu22.04 SSH source separately | Neither fixture started; SSH reference requires an explicit disposable password |
| Operating documentation | README, docs/DEMO_SCRIPT.md and docs/TARGETS.md | Source-only walkthrough; no runtime success claimed |
| Dependency/license handling | Approved pinned modules; per-component third-party notices and release copies | No new global tools installed |
| Commit each repository separately | Five changed repositories have separate source checkpoints on codex/go-rewrite; hashes are recorded in checkpoints.json; .github remains unchanged | Final review and further implementation commits remain; no push/tag/release performed |

## Concrete unfinished work

1. Complete the remaining typed write/restore providers. Ubuntu24.04 has61 control IDs without write handlers and Windows23; Ubuntu22.04 adds12 read-only audit IDs without write handlers; not every audit can be safely fixed by the same generic operation. Implement their actual semantics, backup scope and error paths instead of enabling arbitrary YAML commands.
2. Keep the approved nftables dependency read-only. Firewall mutation must not silently expand that approval. IP forwarding also needs a multi-setting restore plan because its kernel side effects exceed the current single-sysctl snapshot.
3. Resolve the three credential-sensitive manual inspection entries without weakening the current privacy boundary. Missing/ambiguous evidence must remain error throughout.
4. Finish semantic API/data-shape review. Route registration, compilation and reused TypeScript clients are necessary evidence, not proof of full legacy behavior.
5. Complete final cross-repository review and incremental implementation commits; initial separate checkpoints are recorded in checkpoints.json. Keep the proto v0.0.0 bootstrap local to the documented sibling workspace until an explicitly requested publication step.

## Verification evidence at this checkpoint

- Windows amd64: core, proto, Linux agent and Windows agent compile.
- Linux amd64: the same four module package trees compile, including platform fallback files.
- Windows386: Windows agent compiles after the system-DLL loader changes; this is compiler evidence only, not an expanded runtime support claim.
- Release PowerShell script parses after both agent notice files were added. The script itself was not executed.
- Earlier React TypeScript/Vite compilation and bridge syntax evidence is recorded in progress.md. Frontend/bridge source was not changed during this checkpoint, so those commands were not repeated without a new reason.
- No test command, live OS observation, agent/service/watchdog execution, database connection or compose operation was used for this checkpoint.

## Checkout integrity before checkpoint commits

Review found that platform-dependent Git newline conversion could alter canonical manifest bytes or retained source hashes. Attributes now preserve native JSON/imported YAML/upstream bytes, and the retained container entrypoint uses LF. Its previously generated CRLF shebang was normalized before any image build. Dependency-review sources, node_modules, binaries, private state and actual .env files are excluded from commit candidates. Commit checkpoints do not close the unfinished implementation items above.

## Ubuntu22.04 native inspection checkpoint

The matching native assignment now preserves all100 original IDs/severities. Its99 connected entries include12 additional read-only audit controls, with USR006 still manual. The shared88 definitions match the24.04 catalog. Package status, conservative persistent auditd enablement and bounded AUDIT_LIST_RULES metadata providers are wired into the scanner. Initial enrollment supports either release, while one-shot/daemon scans and new tasks require the matching assignment; retained recovery/results still precede that guard. Core maps the22.04 native ID back to its original baseline.

Windows amd64 and Linux amd64 package-tree compiler checks passed. The Linux agent also compiled standalone for both targets using its pinned x/sys version and an artifact-local proto replacement, with network fetching disabled. Canonical/embedded manifest bytes and SHA256 match. No tests, live audit queries, scans, service actions or deployment ran. Loaded selector presence does not prove global audit enablement, complete rule coverage or event delivery. No new dependency or audit/firewall write capability was added.

## Windows notice and anonymous-pipe writers

Windows now has59 compiled handlers:31 DWORD policies, two fixed baseline notice strings, one anonymous-pipe list removal, seven account-policy scalars and18 audit policies. Exact typed string/list snapshots integrate with the existing private DPAPI journals, native rechecks and independent watchdog. Compliant existing text/empty lists remain untouched. Core requires explicit risk confirmation for all three additions. Original registry bytes or value absence are restored; malformed/unreviewed encodings are refused before mutation and contents are not sent to core. No native call, test, service action or policy modification ran.

## Native service write/restore checkpoint

All six Windows service IDs now have typed SCM actions with explicit core risk confirmation, raising write coverage to65 controls. The selected service is disabled/stopped; the exact startup, delayed-start and stable runtime tuple is saved privately with a fingerprint of unmodified basic SCM configuration. Missing services remain untouched. Recovery handles journaled partial transitions while rejecting configuration drift. Direct dependencies must already run before restarting; dependency groups and force-stopping dependents are refused. Task context checks bound cooperative write steps; compensation is independent of the expired task context. Native synchronous calls remain unpreemptible. Source limits and inspected vendor references are recorded in the Windows README.

Windows amd64/386 and Linux amd64 compiler checks passed after implementation. No tests, service queries, native changes, helper execution or runtime validation ran. The original read-only service audit checks startup type; service actions additionally verify stopped runtime state. Process memory, in-flight jobs and custom startup arguments are outside this policy-state snapshot.

## Native user-right and catalog4 checkpoint

All12 Windows user-right controls now have typed local LSA actions with explicit core risk gating, private canonical SID-set backups and compensation of approved partial membership changes. Windows write coverage is77 controls, with23 remaining. Domain controllers are refused. Each call changes only the selected right; secret/private information and remove-all privileges are never requested. Deny/network contains targets preserve unrelated assignments; exact-set targets match the reviewed baseline remediation. No SID/account name is sent to core.

Native-windows-4 retains all100 IDs/severities and98 connected providers per OS. URA007 now compares its exact four-SID baseline, and service audits require disabled startup plus stopped runtime state. These deliberate native semantic corrections close drift gaps; original YAML bytes remain unchanged. Canonical/embedded copies match and new hashes are documented. The catalog importer was syntax-parsed without execution. Windows amd64/386 and Linux amd64 compilation passed; no tests, native queries, policy writes or recovery exercise ran.
