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
| Ubuntu22.04 legacy baseline | Original100-control YAML is retained and loaded by core | Native Ubuntu22.04 assignment is still missing, including its12 audit controls; full scope includes this baseline |
| Linux platform scope | RequireUbuntu2404 before initial enrollment, scans and new task work | Namespace metadata is not whole-host attestation; existing recovery/delivery precedes the guard |
| Windows inspection | Three100-control manifests;98 connected providers and2 manual controls per OS; embedded/canonical bytes match | Complexity/reversible-storage audits remain manual; native availability is unexercised |
| Windows service hosting | Confirmed installer, LocalSystem SCM hosting, protected state/bootstrap, cancellation/restart source | No service installed or started; binary upgrades require separate review |
| Typed remediation and rollback | Core task API,27 Linux handlers and56 Windows handlers; private backups and exact native restores | Full prototype remediation parity remains incomplete |
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

1. Complete the remaining typed write/restore providers. Ubuntu24.04 has61 control IDs without write handlers and Windows44; the additional Ubuntu22.04 native assignment and its audit controls are also required; not every audit can be safely fixed by the same generic operation. Implement their actual semantics, backup scope and error paths instead of enabling arbitrary YAML commands.
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
