# Target and enrollment scope

| Agent | Native assignment | Required platform | Inspection scope |
| --- | --- | --- | --- |
| agent-linux | ubuntu-24.04-native | Ubuntu24.04, Linux amd64 | Current filesystem/network namespace, reviewed fixed paths and read-only kernel queries |
| agent-windows | windows-10-native-registry | Windows10 build10240..21999 workstation | Native registry, policy, service and fixed WMI providers |
| agent-windows | windows-11-native-registry | Windows11 build22000+ workstation | Same reviewed provider catalog |
| agent-windows | server-2022-native-registry | Windows Server2022 build20348 | Same reviewed provider catalog; local account-policy writes refuse domain controllers |

The original ubuntu-24.04-native-filesystem assignment remains a ten-control subset and also requires matching Ubuntu24.04 metadata. Original CIS-style benchmark IDs can select compatible native controls in core; this is a mapping of content IDs, not independently verified CIS compliance.

Enrollment tokens are scoped, expiring and revocable. New clients persist a request ID and immutable payload before enrollment so a lost response can be recovered without duplicating the agent. Identities, spool entries, backup data and enrollment secrets belong to the agent's private state. Do not publish them or pass secrets in service command-line arguments.

Linux service source is in agent-linux/deploy. Its state directory is private and recovery helpers must outlive main-process failure. Windows service installation uses protected Program Files/ProgramData locations and LocalSystem; interactive-administrator mutation is refused. No service is automatically installed by the rewrite.

A container, chroot or namespace does not establish a whole-host audit. Read-only providers return error when evidence is missing, unsafe, out of scope or unreviewed. Native write support is separately limited to compiled typed plans. Read each agent's capability documentation before authorizing any remediation. No target was contacted or scanned while preparing this documentation.
