# Native agent demo guide

These are operator instructions for an isolated lab. They were not executed in this session. The current instruction forbids tests; compilation does not establish operational readiness.

1. Keep all six repositories as siblings and initialize the local Go workspace as described in core/README.md. Build binaries with scripts/build.ps1 when ready. The optional Makefile only wraps compilation and compose operations; Windows development does not require installing make.
2. Configure a fresh local environment from .env.example, replacing every placeholder privately. Do not use or import the old project's real .env or database. Start the core stack only when explicitly ready to deploy it.
3. Sign in and change the initial administrator password. In Assets, create a scoped enrollment token for the correct native OS benchmark. Provision it privately to the agent using its own README. Windows service installation leaves the LocalSystem service stopped until its private bootstrap file is provisioned.
4. Start a scan-only agent on the matching disposable OS. Linux requires Ubuntu22.04 or24.04 identity metadata matching its native assignment. Windows requires the assigned Windows10/11/Server2022 build family. A container report describes the container filesystem/network namespace, not an attested host view.
5. Inspect the enrolled agent and heartbeat in Assets. Queue a scan for that asset and inspect the resulting report, evidence statuses, score and error count. Unsupported observations remain errors and must not be described as successful control coverage.
6. Inspect analytics, ATT&CK mappings, report exports and audit records. With no configured AI key/model the copilot uses its catalog-based fallback. Optional AI prompts exclude host identifiers, credentials and raw agent evidence.
7. To review remediation, create a plan using supported controls. The plan must show risk/reboot information and private local-backup behavior. Agents are scan-only by default. Enabling remediation is a separate explicit local choice; new account/network/authentication actions also require risk confirmation in core. Source contains independent watchdogs, but they have not been exercised here.
8. Optional session recording requires the sessions compose profile and separate Guacamole/control secrets. It is independent of native scanning. Recordings and their access stay subject to operator authorization.

The primary fixture is lab/agent-linux. The retained lab/ubuntu-target is an Ubuntu22.04 SSH reference excluded from default deployment. It requires separate native-agent provisioning for ubuntu-22.04-native. Neither fixture has been run as evidence of native scan behavior.
