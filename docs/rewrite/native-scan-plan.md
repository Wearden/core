# First native scanning milestone

Authorized scope: Go rewrite, existing React/content reuse, JSON Schema contract. Execute inline.

1. Define versioned wire types, validation and JSON Schemas for enroll, heartbeat, report and config. Test malformed reports, unknown/duplicate IDs, timestamps and score exclusion. No third-party dependency installation.
2. Add reviewed native filesystem rule definitions separate from unchanged legacy YAML. Explicitly version semantics rather than claim old shell checks are identical.
3. Implement read-only Linux kernel-module and mount checks, with injected filesystem tests. Never execute YAML commands or change OS configuration. Missing or ambiguous evidence must not pass.
4. Implement CLI JSON output, authenticated report client with bounded timeouts and TLS requirements; test using a local HTTP fixture. Until core ingestion exists, do not claim real enrollment or durable delivery.
5. Cross-build Linux amd64; run fixtures on Windows. Document that cross-build and fixtures are not Linux lab verification. Review the whole milestone using a fresh reviewer.

Deferred to next milestone: PostgreSQL driver/source review, durable core ingestion, enrollment server, queue/spool/service mode, React integration, remaining Linux categories, Windows agent, hardening and rollback. Their status remains not implemented, not silently stubbed.

Verification: go test ./proto/... ./agent-linux/...; go vet ./proto/... ./agent-linux/...; Linux amd64 build. Core/ruleset/proto remain independent repositories.
