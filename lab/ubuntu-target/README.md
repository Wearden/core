# Legacy SSH lab reference

This Ubuntu22.04 SSH target is retained from the prototype as requested. It is independent of the primary Ubuntu24.04 native agent fixture. It is not attached to the normal compose configuration or automatically started.

The Dockerfile is retained unchanged. The entrypoint retains the disposable sudo-capable lab account, requires an explicitly supplied LAB_SSH_PASSWORD instead of a built-in password, and validates account/field separators before provisioning. It intentionally gives that isolated account passwordless sudo for legacy demo flows. Do not expose it publicly, reuse real credentials, run it privileged or mount host filesystems. No real .env, credential values, identities or SSH private keys were copied.

This image is not applicable to the Ubuntu24.04 native catalog. The new agent refuses mismatched distribution metadata. Use lab/agent-linux with docker-compose.lab.yml for the native fixture. No image build, container start or SSH session was executed during this rewrite.
