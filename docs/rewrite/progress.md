# Rewrite progress

Updated 2026-11-15. Full Go rewrite remains active. Latest user instruction: complete the project without running tests. All earlier test evidence belongs to the earlier filesystem-only milestone; it does not verify the expanded implementation.

## Implemented source

- Six separate sibling Git repositories retained. Original prototype untouched.
- Core Go API: PostgreSQL schema/bootstrap, bounded DB pool, Argon2id passwords, hashed opaque access/rotating refresh tokens, RBAC, initial password change, login throttling, assets, encrypted optional host credentials and audit.
- Agent enrollment tokens scoped to OS/native benchmark, atomic single consumption, hashed agent credentials, revocation, heartbeat and digest-pinned assignment/config delivery.
- PostgreSQL-backed queued scan jobs, report identity/scope/severity/full-coverage validation, atomic idempotent report persistence and retained React scan/result data shapes.
- Legacy and native benchmark catalog loading, saved profiles, dashboard/host analytics, heatmap, before/after diff, ATT&CK coverage, copilot with static fallback, CSV/JSON/PDF exports (PDF uses embedded Unicode font and bounded in-memory rendering).
- Durable scan scheduling/score-drop alert source, bounded public HTTPS webhooks, stale-agent/job expiry worker and authenticated same-origin WebSocket snapshots.
- React source migrated and branded, Assets agent enrollment/list/revoke added. Optional Guacamole/guacd integration now binds exact token hashes, single-use opening, expiry, active-user revalidation and confirmed connection termination with authenticated internal controls.
- Docker/compose source and configuration examples added. No real .env copied, opened or generated. No deployment command executed.
- Linux: full 88-control native catalog, 87 evaluator entries and one explicit unsupported error (USR006); UFW uses a bounded read-only nftables subset. Foreground daemon: private persistent identity, heartbeat/config fetch, assignment digest checks, schedule loop and durable retry spool. No shell execution.
- Windows: 100-control catalogs per OS; registry/account-policy/rights/audit/service coverage expanded to 98 native entries, 2 explicitly manual in the current source. DPAPI identity, heartbeat/config, periodic scans and durable report spool. The two manual password-policy checks do not inspect password or SAM stores.

- Typed core hardening plan/run/rollback APIs and authenticated agent task/result transport are implemented, with local-only backup locators and idempotent result handling. Linux and Windows mutation engines are integrated; only explicitly reviewed capabilities can be queued (27 Linux,56 Windows). Backups, local crash recovery and durable task-result replay are implemented; independent platform watchdogs compensate unacknowledged applies; actions outside the reviewed allowlists remain disabled.
- Drift is derived from agent rechecks against applied-change baselines; manual drift refresh queues actual scan jobs.

## Still incomplete for the full goal

- Independent Linux/Windows watchdog source is implemented. High-risk remediation parity remains incomplete: actions outside the reviewed 27 Linux and 56 Windows capabilities are refused.
- Linux USR006 and two Windows password-policy controls remain manual to avoid credential-store reads. Conservative native interpreters can still return error outside reviewed subsets; no claim of full baseline compliance.
- Final cross-repository source audit remains in progress. PDF rendering and typed task code are implemented and compile, but no rendering/native/runtime tests were run.
- Local release packaging script exists. Proto remains a local v0.0.0 workspace dependency; publishing/tags are not performed without separate instruction.
- Final source parity audit and complete operational documentation.

## Current verification boundary

User explicitly requested no tests. No tests, live agent scans, application startup or compose deployment were executed during the expanded rewrite. Windows amd64 compilation of core, proto, agent-linux and agent-windows passed at the last compiler invocation. Current source has compiler checks; subsequent edits require fresh compilation. React TypeScript compilation and Vite production build passed using the existing legacy node_modules via an ignored local junction; no dependency install was needed. Native application startup and deployment have not been run. Compiling code is not proof of native OS or database/runtime correctness.

## Rulings carried forward

- Unsupported/ambiguous check evidence remains error, never artificial pass. This preserves accounting while making coverage gaps visible.
- PostgreSQL replaces Celery with durable scan jobs and a background scheduler, not an in-memory fake store. Original data is retained outside the new database.
- Source-reviewed Go dependencies were approved by the user. Package caches may be written by Go. Automatic PostgreSQL password/service/client-certificate file discovery is disabled in core's DB setup.
- New core credential vault uses AES-GCM, not the legacy Fernet format. No automatic legacy credential import.
- Late evidence for an expired/cancelled assigned scan can be durably acknowledged without reviving the terminal scan, avoiding a permanently poisoned agent retry spool. Revoked agents are still rejected.
- Legacy browser API shapes and benchmark/control IDs are retained where compatible. Native manifests are independently versioned; original CIS labels remain unverified draft content.
- Test instructions in earlier plans are superseded by the user's current no-test instruction. No claim of runtime verification is made.

Accidental native metadata copies created by a child agent under parent native/windows were preserved rather than automatically deleted, according to the user's artifact cleanup preference. Authoritative content is ruleset/native, and agents use their embedded copies.

## Latest source work

The PDF renderer now uses approved fpdf0.9.0 and embedded GoRegular font from x/image0.45.0. It escapes unsupported/control glyphs visibly, wraps all selected findings, bounds text/pages/output/concurrency, and rejects oversized PDFs explicitly instead of truncating evidence. No sample PDF was generated under the no-test instruction.

Typed task endpoints return HTTP200 matching receipts for initial and duplicate accepted results. Apply statuses are applied/skipped/failed; rollback statuses reverted/failed. Core requires verified after_status=pass plus a local backup locator for applied changes. Agents must opt into remediation locally. Unsupported/risk-heavy actions remain rejected rather than executing YAML commands.

Source-only integration checkpoint: hardening and rollback routes, task deadline expiry, drift recheck/baseline withdrawal, Unicode PDF export and both platform task engines are present. Frontend compilation passed (716 modules,850.97kB main JS before gzip); large-chunk/CJS deprecation warnings remain without unrelated redesign. Go Windows/Linux compilation and bridge JavaScript syntax checks are used, not tests. An isolated container fixture and PowerShell build/distribution script were added but not executed.

## Enrollment, watchdog and UFW checkpoint

Enrollment now persists an immutable local request before sending it; core can replay the same request/credential derivation for a bounded period after a lost response. Linux and Windows persist task journals and run independent helpers; receipt revision0 can be followed by immutable revision1 compensation evidence when an acknowledgement is lost or the safety lease expires. Restoration failures block further mutation pending explicit local recovery. These source paths have not been exercised.

Linux native-linux-3 preserves all 88 controls, with 87 connected evaluator entries and one explicit credential-file-dependent manual entry. FW002..006 use read-only nftables v0.3.0 with raw-expression omission guards, generation stability, deadlines and resource bounds. No firewall-writing API is called. Standalone Linux/Windows Linux-agent compilation passed; no tests, kernel queries or live scans ran. Exact catalog limitations are documented in ruleset/native/linux/ubuntu-24.04/README.md.

## Windows SCM and compiler checkpoint

The Windows agent now has native LocalSystem SCM hosting and explicit install/start/stop/uninstall commands. Installation creates protected fixed Program Files/ProgramData paths and a private bootstrap-token file, then leaves the service stopped. Enrollment secrets are not passed through command-line arguments. Remediation defaults off and is enabled only by the operator's local install/run option, persisted in private service configuration. Uninstall retains binaries, identity, logs and backups. Binary upgrades require separate review. Synchronous native calls can delay service stop. No installer/service operation was executed.

Fresh compiler checks passed for Windows amd64 core/proto/Linux-agent/Windows-agent and Linux amd64 core/proto/Linux-agent after the SCM opt-in and UFW changes. PowerShell release-script parsing and bridge JavaScript syntax also passed. The Linux agent additionally compiled independently of the sibling workspace for Linux and Windows. No tests, application startup, live OS scans, firewall queries or service operations were executed. Runtime correctness remains unverified by design under the user's instruction.

## Typed Linux network-parameter actions

Seven redirect/source-route controls NET002..008 now use the existing durable sysctl snapshot, dedicated configuration file, native recheck, independent watchdog and verified restore path. Core marks these actions risky regardless of the preserved YAML flag and enforces confirmation in run creation. Plan and change records expose the same risk. Linux mutation coverage is now27 controls. NET001 remains excluded until side effects of ip_forward are covered by a multi-setting backup/restore plan. Windows/Linux compiler checks passed after the source change; no tests or host mutations were executed.

## Expanded Windows registry remediation

The existing SYSTEM-only DPAPI/watchdog/registry snapshot path now handles31 reviewed DWORD controls, adding21 controls for signing, UAC, NTLM/LM, RDP and session timeouts. Core requires explicit risk confirmation for these additions and exposes the same risk in plans and persisted change records. Timeouts preserve positive values already tighter than the baseline, reject disabled zero as noncompliant, and keep exact original bytes for rollback. Three OS catalogs were inspected and agree on the fixed values.

Registry handlers preserve value absence, refuse missing keys/unexpected types and detect external drift. Registry configuration recheck does not establish loaded service state or post-reboot behavior; no restart/reboot is performed. Driver startup, LSA protection, strings and non-registry providers still need their own write/restore plans. Both Windows and Linux compiler checks passed after these changes. No tests, native policy changes or live scans were run.

## Local account-policy checkpoint

Windows native write coverage is now38:31 registry controls plus PWD001/PWD003..008 local policy scalars. The compiled account-policy targets use typed NetUserModalsSet levels; originals use a distinct numeric snapshot kind inside existing DPAPI backups/journals. Stronger compliant values remain untouched. LocalSystem, operator risk confirmation, local opt-in, watchdog and native version checks remain mandatory. Domain-controller writes are refused. Password/hash/history contents and SAM files are not opened.

Source audit also found and corrected a watchdog validation mismatch introduced by preserving tighter timeout values: the helper now accepts either the exact compiled baseline or the unchanged compliant original snapshot, using the same validator as journal recovery. No runtime reproduction or tests were performed under the user's no-test instruction. Windows and Linux compiler checks passed.

## Static parity and applicability checkpoint

Source mapping accounts for all57 legacy route declarations, including the three WebSocket patterns and four extension-dispatched exports. route-parity.json records exact current source files/lines and explicitly distinguishes static mapping from runtime parity. All51 original YAML files match the sibling ruleset copies byte-for-byte. All six sibling Git roots were inspected; no parent Git repository exists.

Linux now checks Ubuntu24.04 release metadata before initial enrollment, live scans and fetching new tasks. Only the standard fixed os-release link is permitted. Existing local recovery and retained-result delivery precede the new-work guard. Both target compiler checks passed. No live host metadata, scans or tests ran.

The legacy SSH fixture source is retained under core/lab/ubuntu-target with explicit credential provisioning and no normal compose activation. A source-only Makefile and updated native DEMO_SCRIPT/TARGETS guides now replace obsolete Python/Celery workflow instructions in the new project. No container build/start was performed.

## Completion audit and remaining scoring fidelity

completion-audit.md now separates implemented source, actual compiler/static evidence and unfinished requirements. It records the full remaining mutation scope rather than redefining the goal around the current subset. Source inspection also found that legacy scoring.py rounds passed*100/total, whereas wire.Score currently scales/reorders the floating-point expression before RoundToEven. Decimal-rounding fidelity is a concrete remaining task; no numerical tests were executed.

The Windows scanner, identity and recovery DLL loads now use system-directory loading, and WMI uses an absolute system path with LOAD_LIBRARY_SEARCH_SYSTEM32. Windows amd64/386 compilation passed. Both agent third-party notice files are included by the source distribution script; PowerShell parsing passed without executing that script.

## Scoring operation-order correction

The scoring source gap recorded in the prior checkpoint is now addressed: wire.Score preserves the legacy numerator*100/denominator order and uses one-decimal formatting/parsing instead of scaling by1000 and rounding an integer. The normal CPython3.12 double_round implementation, Python round documentation and local Go strconv documentation/decimal source were inspected. scoring-source-analysis.md records the reasoning and verification boundary. Both target package-tree compiler checks passed; no numerical probes or tests ran.

## Native Windows audit-policy writes

AUD001..018 now use fixed-GUID AuditSetSystemPolicy with the existing DPAPI snapshot/watchdog/restore engine. LocalSystem, local opt-in and explicit core risk confirmation remain mandatory. The selected success/failure pair is read before and after writing; zero restores through the explicit NONE operation rather than UNCHANGED. A separate snapshot tag preserves prior registry/account record compatibility.

The necessary SeSecurityPrivilege is scoped to a temporary locked-thread self token, with existing impersonation refused, NOT_ALL_ASSIGNED checked, cleanup verified and process termination if reversion fails. Ordinary scans do not enable that privilege. Source constants agree with the18 audit controls in every OS catalog. Windows amd64/386 and Linux amd64 package-tree compilation passed. No test or native operation was executed. Windows mutation coverage is now56 controls;44 IDs remain without compiled write handlers.

## Repository checkpoint preparation

Candidate paths were inspected independently in the five changed application/content repositories, with no pre-existing staged changes and no dependency-review sources, node_modules, binaries, private state or actual .env files in the candidate lists. Canonical manifests and imported source content now opt out of newline conversion; the retained lab entrypoint was normalized to LF and gets a Unix-line-ending attribute.

The review also made an additional original-scope gap explicit: the retained Ubuntu22.04 legacy benchmark has100 controls, including12 audit controls, but no native Ubuntu22.04 assignment yet. This is required work, not an intentionally removed platform. No runtime check, image build, test or host operation was performed.

## Separate source checkpoints created

Five changed repositories now have independent initial source checkpoint commits on codex/go-rewrite: proto, ruleset, agent-linux, agent-windows and core. checkpoints.json records their source commit hashes. The .github repository was preserved unchanged. No parent repository, push, tag or release was created. These checkpoints explicitly describe an incomplete rewrite, not a final delivery.

Agent-created author/committer metadata uses a non-personal role identity. Hooks and signing were disabled per command so no test/signing helper ran, and automatic Git maintenance was disabled for the operation. Staged candidate paths excluded actual .env, private state, dependency-review sources, node_modules and binaries. Protected manifest/YAML/script bytes matched staged blobs; staged whitespace checks passed. Compiler checks passed before committing.

## Ubuntu22.04 native assignment

Added ubuntu-22.04-native / native-linux-2204-1 with100 retained controls,99 connected evaluator entries and manual USR006. The canonical and embedded manifests are identical with SHA256 1e76403efd65f140041cc49d4c3b981619b798f550355056e14cad3b73971c78. All88 shared original audit blocks and severities agree with Ubuntu24.04. The12 extra controls inspect auditd package status, persistent enablement and loaded always/exit rule selectors through read-only AUDIT_LIST_RULES. No watched-file contents or event records are read. Bounds, privilege requirements and selector-only interpretation are documented with inspected kernel source references in the22.04 catalog README.

Enrollment accepts either supported release; scans and new task work enforce the matching benchmark. Existing recovery/delivery remains available before assignment guards. Core selects the original22.04 benchmark for legacy-ID scan requests. Scan route source locations were updated after the mapping insertion. The shared27 mutation handlers remain unchanged; no additional audit or firewall mutation is enabled.

Windows/Linux amd64 full package-tree compilation and standalone Linux-agent compilation for both targets passed. Standalone compilation used the pinned dependency set, an ignored artifact-local proto replacement and GOPROXY=off. No tests, native calls, service operations, kernel queries or application execution ran. Entire rewrite remains incomplete as recorded in completion-audit.md.

## Windows typed notice and anonymous-pipe actions

SEC004/005 and SMB010 now have compiled native plans and core risk gating. The two fixed notice strings match all three original baseline remediation values. Existing nonempty text is retained; NullSessionPipes is removed only when configured, with empty/absent state preserved. Snapshots retain exact REG_SZ/REG_MULTI_SZ bytes or absence, reject malformed or oversized encoding and reuse SYSTEM-only DPAPI backups, drift checks, watchdog recovery and native rechecks. Stored descriptors contain no notice text or pipe names. Prior DWORD/account/audit snapshot formats remain compatible. Windows coverage is59 controls;41 remain without write handlers.

Windows amd64 and Linux amd64 full package-tree compilation passed after implementation. No tests or native operations ran. Microsoft registry type/setter documentation was inspected; references and limits are recorded in the Windows agent README.

## Windows SCM control and recovery

SVC001..006 now use local typed SCM calls and the existing SYSTEM-only DPAPI/watchdog engine. Core confirms their risk independently of retained YAML flags. Snapshots preserve startup, delayed-start and stable stopped/running state plus a hash of unmodified basic service configuration. The journal/recovery path can restore approved intermediate field combinations; unrelated executable/account/dependency/configuration changes are refused. A disabled-but-running original is restored through temporary manual startup followed by disabling it again.

No service is created/deleted. Stops never force dependent services. Restarts require already running direct dependencies; dependency groups, unavailable evidence, drivers and paused states require manual review. Only the fixed six compiled target names can be changed. Changes and backups sent to core expose fixed descriptions only. Task execution now passes its context into native replacement so service substeps check cancellation/deadlines; compensation keeps its independent context. The prior registry/account/audit snapshot formats remain unchanged.

Windows write coverage is65 controls, with35 IDs remaining. Windows amd64/386 and Linux amd64 package compilation passed. No tests, live service queries/actions or watchdog execution ran. These are source/compiler checkpoints, not a runtime recovery claim.

## Local LSA right assignment writers

URA001..012 now have compiled membership plans, core risk gating and canonical binary SID snapshots under their own tag. LocalSystem/private DPAPI/watchdog requirements remain. The local LSA handle requests only view/lookup and optional policy account-record creation for writes; domain controllers are refused. No secret query, name lookup, remote handle, shell/secedit or remove-all-rights call is used. Individual set mutations recheck expected membership and task context before each call. Recovery handles only approved original/target membership combinations and restores the exact original set. A256-member bound and remove-before-add ordering keep all intermediates serializable.

Contains-mode deny/network plans preserve existing assignments; exact plans use baseline defaults, including the four impersonation SIDs. Native catalog4 tightens URA007 and service runtime observations so reports can detect those post-apply regressions. The importer source reflects version4 and the strict impersonation matcher. All three canonical/embedded copies remain identical, with100 controls and98 connected entries each. Original legacy YAML is untouched.

Windows coverage is77 typed writers;23 remain. Windows amd64/386 and Linux amd64 compilation passed. Python catalog-importer syntax parsing did not execute it. No tests, LSA/SCM queries or mutations, service operations or watchdog execution ran.

## INetFwPolicy2 local scalar providers

Added six typed firewall actions for enabled flags and default inbound Block across Domain/Private/Public. The source uses fixed SDK vtable methods and single-profile bits; rules, groups, resets, outbound policy and logging remain untouched. Exact logical values use a separate DPAPI snapshot kind. Apply has a current-profile modification precondition in both preparation and dispatch; saved-value drift/rechecks and independent recovery remain required. Restore is not blocked by the apply-only management-policy check. Core forces explicit risk confirmation. Local settings are not effective-policy or connectivity attestations.

Microsoft partial-instance update documentation and existing WMI source were inspected for the remaining providers. Provider support is not universal, and no full-instance replacement was introduced to bypass that uncertainty. Logging/WMI remains concrete unfinished work. Windows coverage is83 controls with17 IDs remaining, and the original full rewrite scope remains active.

Windows amd64/386 and Linux amd64 package compilation passed. No tests, COM activation, firewall query/write, service action or native runtime execution ran. SDK netfw.h/icftypes.h method order, IDs and scalar types were read from installed source; no new package was installed.

## Frontend rotating refresh coordination

Source review found that concurrent401 responses reused the same single-use refresh token, while core deletes it transactionally. The frontend now shares refresh work per session, retries late401 responses with an already refreshed access token, ignores stale refresh responses after logout/login, and refuses to replay an old request under a new login session. Session generation is preserved only by internal token rotation. TypeScript no-emit compilation passed; no browser session, token store, network request or test was exercised. Full semantic API review remains unfinished.

Protected binary downloads now share the same bounded authenticated-response/refresh path as JSON requests. This covers session recordings after access-token expiry without bypassing session-generation guards. TypeScript no-emit compilation passed again; no browser storage, credentials, network call or test was exercised.

## Bind hardening preview to submitted selection

Source review found that changing hosts, controls or source scan retained an actionable preview for the previous selection. Preview state now carries the canonical benchmark/scan/host/control selection key; mismatched or late responses cannot authorize the displayed selection. Selection changes reset risk confirmation, and the apply handler independently requires a matching preview and confirmation. TypeScript no-emit compilation passed. No UI/browser action, API call, native task or test ran.

Preview source review additionally covered selection A/B/A and overlapping responses: selection changes now invalidate pending preview generations and clear the review. New previews reset confirmation; stale success/error/finalization callbacks cannot replace the current review or busy state. TypeScript no-emit compilation passed; no tests or live UI operations ran.

Failed-control preselection now also rejects late results after selection/preview generation changes and surfaces current request failures through the existing error UI. Earlier overlapping preselection requests cannot replace newer selections. TypeScript no-emit compilation passed; no test, browser or API call ran.

Hardening request-state review separated planning from apply-in-flight state. Selection changes can invalidate previews without clearing the apply guard; a second apply or preview cannot start while run creation is pending. TypeScript no-emit compilation passed. No runtime/API operation or test was performed.

Hardening cancellation failures now appear outside the applied-change-only rollback toolbar. The cancel button is disabled while pending; English/Azerbaijani fallback messages were added. TypeScript no-emit compilation passed; no test or live API operation ran.

Rollback run navigation now resets selection/name/detail/error state. Selected rollback IDs are intersected with currently applied changes, so a polling status update cannot leave obsolete IDs in the request or count. TypeScript no-emit compilation passed; no tests or live rollback ran.

## Explicit rollback selection boundary

Source comparison found that an explicit empty change_ids array was treated as rollback-all. Empty arrays now fail400 before opening a database transaction; null/omitted retains the existing all-restorable behavior used by the frontend. Nonpositive IDs are also rejected before database access. Windows/Linux amd64 core compilation passed. No tests, DB connection, request or rollback task ran.

## Per-control unfinished native write ledger

remaining-native-writes.json now derives every missing ID from current native manifests and the server capability allowlist, grouped by provider kind. This preserves both Ubuntu releases and all Windows assignments rather than reducing scope to supported controls. The ledger distinguishes static source coverage from runtime applicability. No native operation or test ran.

## Linux SSH integration source findings

The14 SSH content controls were mapped to their native targets in linux-ssh-write-analysis.md. Source review identified separate directory-creation and missing-parent backup allowlists, implicit-option error gating, first-value include precedence, banner-file dependency and loaded-daemon validation/reload as coupled implementation requirements. These findings determine the next provider work; no generic file writer or unsupported capability was enabled. Linux coverage remains27. No tests or native operations ran.

SSH provider preparation now centralizes14 compiled baseline option/value pairs in checks/ssh_policy.go. Numeric observations use the same baseline accessor intended for typed mutation planning, retaining tighter-value and disabled-zero semantics. Linux and Windows amd64 Linux-agent compilation passed. Write dispatch remains disabled pending the documented backup/include/banner/reload integration; no tests or native operations ran.

SSH drop-in preparation now has an explicit source helper that accepts only compiled options, validates the existing SSH/include grammar, requires the standard include and rejects earlier main-file directives that would override the managed setting. It returns a fixed directive only; write/backup/recheck/banner/reload integration is still required and task dispatch stays disabled. Earlier included-file precedence still requires post-write observation and restoration. Linux/Windows amd64 Linux-agent compilation passed. No tests, file mutation, daemon signal or live SSH observation ran.

SSH backup preparation now shares one reviewed directory policy across parent creation, missing-parent snapshots and created-parent restoration validation. The SSH drop-in directory is included for the forthcoming provider; task dispatch remains disabled. Inconsistent created-parent records fail before restoration. Linux/Windows amd64 Linux-agent compilation passed. No test, host file mutation or SSH operation ran.

SSH drop-in preparation now brackets grammar/include evaluation with matching reads of the main configuration. A changed main file is refused instead of using an unvalidated second version. This is a stability guard, not an atomic multi-file snapshot. Linux/Windows amd64 Linux-agent compilation passed; no tests or native operations ran.

SSH mutation planning now resolves exact embedded rule metadata and compiled baseline values into fixed root-owned0600 drop-in plans. Execution explicitly refuses those plans before observation/backup/write until banner and daemon validation/reload integration is complete. Core capabilities remain unchanged, so these14 IDs are still unfinished in the ledger. Linux/Windows amd64 Linux-agent compilation passed; no tests or native operations ran.

The SSH banner plan now identifies the separate fixed issue.net companion and the exact original baseline notice text. Restore validation requires the planned companion, rejects unrelated/nested companion paths and retains sysctl companion compatibility. SSH execution remains blocked, so no banner snapshot/write/reload is enabled yet. Linux/Windows amd64 Linux-agent compilation passed. No tests or native operations ran.

Companion handling now snapshots the compiled companion path for file plans as well as existing sysctl persistence. File-plan sequencing writes the companion before its primary file and propagates failure into existing restoration. This prepares the banner dependency without enabling SSH execution: its explicit guard still returns before observation/backup/write. Linux/Windows amd64 Linux-agent compilation passed; no tests, banner/SSH writes or daemon operations ran.

SSH banner observation now requires the configured fixed issue.net file to exist and contain nonblank text. Missing/empty banners fail; unsafe/unavailable/symlinked/oversized evidence returns error. Native no-follow bounded reads are reused, and contents are not emitted. This prevents the future post-write check from passing on the Banner directive alone. Linux/Windows amd64 Linux-agent compilation passed; no tests, live banner reads or SSH operations ran. Native SSH write dispatch remains disabled.

File-plan companion verification now checks exact compiled bytes, root ownership and0644 mode before accepting the normal native observation. A mismatch enters the existing restore path. This prepares banner post-write validation while SSH execution remains explicitly blocked. Linux/Windows amd64 Linux-agent compilation passed; no tests, live companion/banner reads or mutations ran.

Upstream SSH lifecycle research confirmed that -t/-T include key checks, whereas -G was introduced in9.3 without private-key loading. The implementation design now requires a version-aware key-free validation path and forbids an implicit -t/-T fallback. Older supported releases remain in scope and require a compatible design. Manual/release references and SIGHUP re-exec implications are recorded in linux-ssh-write-analysis.md. No daemon/version probe, key read, signal, test or native operation ran.

Key-free SSH validation preparation now includes a bounded output parser:1 MiB total,64 KiB line ceiling, duplicate/missing/malformed selected-option rejection and14 option comparison booleans only. Unselected daemon output and selected raw values are not returned. Numeric tighter-limit and disabled-zero semantics match current observations; banner results describe only the directive, not its file or loaded state. Linux/Windows amd64 Linux-agent compilation passed. No parser execution, test, sshd invocation, key read or native operation ran. Daemon binding/reload and older-version support remain unfinished.

SSH validation output size is now enforced on raw bytes before line scanning, so CRLF normalization cannot undercount an oversized stream. The parser still returns only selected comparison booleans. Linux/Windows amd64 Linux-agent compilation passed; no parser exercise, test, daemon invocation or native operation ran.
