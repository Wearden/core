#!/bin/bash
set -euo pipefail
: "${LAB_SSH_USER:=labadmin}"
: "${LAB_SSH_PASSWORD:?Provide a disposable lab password explicitly}"
if [[ ! "$LAB_SSH_USER" =~ ^[a-z][a-z0-9_-]{0,30}$ ]]; then
  printf '%s\n' 'Invalid lab account name' >&2
  exit 1
fi
if [[ "$LAB_SSH_PASSWORD" == *:* || "$LAB_SSH_PASSWORD" == *$'\n'* || "$LAB_SSH_PASSWORD" == *$'\r'* ]]; then
  printf '%s\n' 'Lab password cannot contain account-field separators' >&2
  exit 1
fi
if ! id "$LAB_SSH_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$LAB_SSH_USER"
fi
printf '%s:%s\n' "$LAB_SSH_USER" "$LAB_SSH_PASSWORD" | chpasswd
usermod -aG sudo "$LAB_SSH_USER"
printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$LAB_SSH_USER" > "/etc/sudoers.d/90-$LAB_SSH_USER"
chmod 0440 "/etc/sudoers.d/90-$LAB_SSH_USER"
exec /usr/sbin/sshd -D -e
