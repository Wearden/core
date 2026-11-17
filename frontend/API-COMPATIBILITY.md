# Wearden frontend API compatibility

Source inspection only. No packages installed, builds run, tests run, or live endpoints called.

All REST routes below are under `/api`. Responses are unwrapped JSON objects/arrays. Dates are ISO 8601 strings. Return `[]` for empty collections, never `null`. Numeric asset/result/change IDs and string scan/run/session/agent IDs must retain their types. Nullable fields must be present with `null` because components use strict null checks. Errors use `{ "detail": "human-readable message" }`. Empty successful mutations return 204. Server authorization is mandatory; hidden UI buttons are not an authorization boundary.

## Authentication

| Method and route | Request | Response |
| --- | --- | --- |
| POST `/auth/login` | `{username,password}` | `Tokens` |
| POST `/auth/refresh` | `{refresh_token}` | `Tokens` |
| GET `/auth/me` | Bearer access token | `User` |
| POST `/auth/change-password` | `{current_password,new_password}` | 204 |
| GET `/health` | Public | `{status:"ok"}` |
| GET `/health/ready` | Public | `{status:string,database:"ok"}` |

`Tokens = {access_token,refresh_token,must_change_password:boolean}`. `User = {id:number,username,role:"admin"|"operator"|"viewer",must_change_password:boolean}`. API client retries one 401 after refresh. JWTs remain in legacy browser storage key `hardenops.tokens`; language key is `hardenops.lang` for compatibility. Binary downloads do not retry refresh. Password change must clear `must_change_password` server side so the next `/auth/me` grants normal navigation.

## Assets and agents

Exact legacy shapes are declared in `src/types.ts`; `AssetInput` contains name, host, os_type, nullable os_version and port fields, tags. `Asset` adds numeric id, os_detected, privilege, credential_username, status, nullable latency_ms, last_seen and last_checked. `tags` must always be an array. Credential metadata supports optional remote SSH/RDP sessions; agent execution must not require stored host credentials.

| Method and route | Request | Response |
| --- | --- | --- |
| GET `/assets` | | `Asset[]` |
| POST `/assets` | `AssetInput` | `Asset` |
| PUT `/assets/{id}` | `AssetInput` | `Asset` |
| DELETE `/assets/{id}` | Admin | 204 |
| PUT `/assets/{id}/credential` | `{username,auth_type:"password"|"ssh_key",secret}` | 204 |
| DELETE `/assets/{id}/credential` | | 204 |
| POST `/assets/{id}/test` | | `{ok,message,os_detected,privilege,latency_ms}` |
| GET `/assets/{id}/history?limit=60` | | `{checked_at,status,latency_ms}[]` |
| GET `/audit?limit=200` | | `AuditRow[]` from `src/types.ts` |
| GET `/agents` | | `Agent[]` |
| POST `/agents/enrollment-tokens` | Admin: `{os:"linux"|"windows",benchmark_id,ttl_minutes:number}` | `{token,expires_at}` |
| POST `/agents/{id}/revoke` | Admin | 204 |

`Agent = {id:string,asset_id?:number,hostname,os:"linux"|"windows",benchmark_id,status,last_seen:string|null}`. Agent management is embedded in Assets. Tokens remain in component memory and are not persisted to browser storage. Enrollment backend must create/link an asset so legacy scan and hardening `asset_ids` resolve to the correct enrolled agent.

## Benchmarks

Canonical response types are in `src/benchmarksApi.ts`.

| Method and route | Request | Response |
| --- | --- | --- |
| GET `/benchmarks` | | `BenchmarkSummary[]`: id, os, name, version, control_count |
| GET `/benchmarks/{bid}/controls` | | `ControlSummary[]` |
| GET `/benchmarks/{bid}/controls/{cid}` | | `ControlDetail` |
| GET `/benchmarks/{bid}/profiles` | | `Profile[]` |
| POST `/benchmarks/{bid}/profiles` | `{name,control_ids:string[]}` | `Profile` |
| DELETE `/benchmarks/{bid}/profiles/{pid}` | | 204 |

Control detail includes description, rationale, impact; audit `{type,command,expected,match}`; remediation `{backup:[{type,path,name}],command}`; rollback `{strategy,command}`. Summary includes cis_ref, title, os, category, level, severity, risky, reboot_required, mitre_attack array. Profile is `{id,name,description,builtin,control_ids:string[]}`. Preserve the legacy benchmark identifier and control identifier vocabulary.

## Scans, hardening and rollback

Exact response interfaces are in `src/scansApi.ts` and `src/hardeningApi.ts`.

| Method and route | Request | Response |
| --- | --- | --- |
| GET `/scans` | | `ScanSummary[]` |
| POST `/scans` | `{name?,benchmark_id,profile_id,asset_ids:number[]}` | `ScanDetail` |
| GET `/scans/{id}` | | `ScanDetail` (summary plus message and hosts array) |
| POST `/scans/{id}/cancel` | | `ScanDetail` |
| GET `/scans/{id}/results` | Optional `host_id`, `status_filter` query | `ControlResultRow[]` |
| POST `/hardening/plan` | `{benchmark_id,control_ids,asset_ids,scan_id?}` | `Plan` |
| GET `/hardening/runs` | | `RunSummary[]` |
| POST `/hardening/runs` | Plan request plus `{name?,confirm_risky:boolean}` | `RunSummary` |
| GET `/hardening/runs/{id}` | | `RunDetail` (summary plus changes array) |
| POST `/hardening/runs/{id}/cancel` | | `RunSummary` |
| POST `/hardening/runs/{id}/rollback` | `{change_ids:number[]|null,name:string|null}` | `RunSummary` |
| GET `/hardening/rollbacks` | | `RollbackProcess[]` |

Scan summary requires id/name/benchmark_id/profile_name/status, total_checks/done_checks/host_count, created_by/created_at, nullable started_at/finished_at. Status vocabulary: queued, running, cancel_requested, completed, cancelled, failed. Checks use pass/fail/error/not_applicable. Host results require numeric id, nullable asset_id, asset_name/host/os_detected/status, counts, nullable score/weighted_score/message. Control result rows include host_result_id, asset_name, control_id/title/category/severity/status, actual/expected/raw_output/duration_ms/message/checked_at.

Plan includes controls `{id,title,severity,risky,reboot_required,commands,backups:string[],rollback,rollback_command}`, hosts `{asset_id,asset_name,before:Record<control_id,{status,actual}|null>}`, warnings array. Run summary requires totals, host_count, applied_count, confirm_risky, scan_id, lifecycle timestamps and message. Changes require before/after/rollback statuses and values, seq, backups array, remediation_output and rollback_output. Rollback process requires its own id/run_id/run_name/name, status, total/reverted/failed, created_by and lifecycle fields, legacy boolean.

## Analytics, reports, copilot and sessions

| Method and route | Request | Response |
| --- | --- | --- |
| GET `/analytics/dashboard` | | `DashboardData` in `src/analyticsApi.ts` |
| GET `/analytics/hosts/{id}` | | `HostAnalytics` in `src/analyticsApi.ts` |
| GET `/analytics/heatmap?benchmark_id=...` | | `{categories:string[],rows:[{asset_id,asset_name,cells:Record<string,number|null>}]}` |
| GET `/analytics/diff` | Optional run_id, asset_id, status, q | `{run_id:string|null,run_name?,rows:DiffRow[]}` |
| GET `/attack/coverage?benchmark_id=...` | | `{techniques:[{id,name,controls:string[],before:number|null,after:number|null}],total,mitigated_before,mitigated_after,threshold,hosts_assessed}` |
| GET `/drift?active_only=true` | | `{id:number,severity,message,detected_at}[]` |
| POST `/drift/run` | | `{queued:boolean}` |
| POST `/copilot/explain` | `{benchmark_id,control_id,language:"en"|"az"}` | `{control_id,source:"ai"|"static",text}` |
| GET `/reports/scans/{id}.pdf` | Bearer | PDF binary |
| GET `/reports/scans/{id}.csv` | Bearer | CSV binary |
| GET `/reports/scans/{id}.json` | Bearer | JSON file |
| GET `/reports/hardening/{id}.csv` | Bearer | CSV binary |
| GET `/sessions` | | `RemoteSessionRow[]` in `src/sessionTypes.ts` |
| POST `/sessions` | `{asset_id:number,width:number,height:number}` | `{id,asset_name,protocol:"ssh"|"rdp",token}` |
| POST `/sessions/{id}/end` | | `RemoteSessionRow` |
| GET `/sessions/{id}/recording` | Bearer | Guacamole recording binary; `?format=mp4` returns an H.264 MP4 (409 while the session is open) |

Dashboard fields and analytics nested arrays are accessed directly and must be supplied even when empty. Scores are numeric or null. Guacamole session token must follow guacamole-lite AES-256-CBC encrypted connection-token format using the shared `GUAC_CRYPT_KEY`. The browser connects to `/guac/?token=...`; gateway strips `/guac/`. Session end authorization and recording access control belong in the core API.

## WebSocket contract

Same origin `/ws/hosts`, `/ws/scans/{scan_id}`, `/ws/hardening/{run_id}`. First browser message is `{type:"auth",token:access_token}`; reject invalid authorization with close code 1008. Client reconnects every 3 seconds on other closes. Never place the user JWT in the WebSocket URL.

- Hosts: `{type:"hosts",hosts:[{id:number,status,latency_ms,last_seen,last_checked}]}`.
- Scans: snapshot `{type:"snapshot",scan:{status,done}}`; progress `{type:"scan",status,done}`; host/host_started invalidates detail; check `{type:"check",done,host_id,asset_name,control_id,title,status,actual,expected,duration_ms}`.
- Hardening: snapshot is ignored; change `{type:"change",done,total}`; run `{type:"run",status}`; rollback `{type:"rollback",control_id,asset_name,status}`; other log events use asset_name/control_id/status/message. Every non-snapshot event reloads run detail.

## Migration decisions and remaining assumptions

- Scan selector and hardening selector no longer require `credential_username`; backend must validate OS, enrollment, revocation, approved benchmark/control scope and risk consent for every submitted asset. Legacy selectors filter OS only, so an unenrolled manually created asset can be submitted and must be rejected explicitly.
- Remote session and connection-test buttons still require stored credential metadata. Agent heartbeat is distinct from SSH/RDP connectivity; tooltips now describe agent health. Legacy Sparkline and asset status compatibility is retained.
- Optional SSH/RDP sessions expose powerful remote access. Token expiry, end/revoke semantics, audit and authorization cannot be enforced by this UI alone.
- The legacy browser localStorage JWT mechanism remains. An XSS vulnerability can expose those tokens; no authentication storage redesign was requested.
- Existing WebSocket handlers assume trusted valid JSON messages. Server must not send partial or malformed payloads.
- Existing dashboard/demo components assume newest-first scans/runs and numeric scores. Return deterministic ordering.
- Existing credential form submits actual secrets over the API. Deploy the gateway behind HTTPS before using host credentials; plain HTTP is retained from legacy local compose gateway.
- No dependency installation, build, unit/integration tests, runtime inspection, or network verification was performed, per explicit user instruction.
