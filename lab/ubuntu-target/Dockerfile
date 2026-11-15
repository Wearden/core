# Demo target for Linux scanning and hardening. Not for production.
# It runs sshd and a sudo-capable admin account so the full check, harden and rollback flow can be demonstrated
# without a VM. There is no systemd in this container, so risky controls are refused by the safety net.
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server sudo ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/22' || exit 1
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
