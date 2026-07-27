#!/usr/bin/env bash
# One-time OS-level bootstrap for the self-hosted VPS (CentOS Stream 10).
# Idempotent: safe to re-run. Run once, as root, on a blank box:
#   ssh root@<vps-ip> 'bash -s' < infra/vps/bootstrap.sh
#
# Does NOT write the persistent .env (that has real secrets and is generated
# separately, once, and never committed) and does NOT deploy the app — it
# only prepares the box so infra/vps/deploy.sh can do that on every push.
set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_DIR=/opt/qassistant
DEPLOY_USER=deploy

echo "==> Installing Docker CE + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  dnf -y install dnf-plugins-core
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Configuring Docker log defaults (backstop; compose also sets per-service limits)"
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "5" }
}
EOF
  systemctl restart docker
fi

echo "==> Ensuring a 2GB swapfile exists (cheap insurance on a memory-constrained box)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "==> firewalld: allow only SSH/HTTP/HTTPS"
# Minimal cloud images (this CentOS Stream 10 image included) don't ship
# firewalld by default -- only bare nftables, disabled.
if ! command -v firewall-cmd >/dev/null 2>&1; then
  dnf -y install firewalld
fi
systemctl enable --now firewalld
firewall-cmd --permanent --add-service=ssh || true
firewall-cmd --permanent --add-service=http || true
firewall-cmd --permanent --add-service=https || true
firewall-cmd --reload

echo "==> Creating dedicated deploy user (docker group, no sudo)"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
fi
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "/home/$DEPLOY_USER/.ssh"
touch "/home/$DEPLOY_USER/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh/authorized_keys"
chmod 600 "/home/$DEPLOY_USER/.ssh/authorized_keys"

echo "==> Creating $APP_DIR layout"
mkdir -p "$APP_DIR"
chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
if [ -n "$REPO_URL" ] && [ ! -d "$APP_DIR/app/.git" ]; then
  command -v git >/dev/null 2>&1 || dnf -y install git
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$APP_DIR/app"
fi

cat <<EOF

Bootstrap complete. Remaining manual steps (see openspec change design.md):
  1. Generate the persistent /opt/qassistant/.env (DB_PASSWORD,
     SECRETS_ENCRYPTION_KEY, S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY,
     SUPER_ADMIN_EMAIL/PASSWORD, SITE_ADDRESS, a GHCR pull token) — never
     committed, never passed through CI. Back up SECRETS_ENCRYPTION_KEY and
     DB_PASSWORD somewhere safe outside this box; losing them loses the
     ability to decrypt stored secrets / restore backups.
  2. Restrict the deploy SSH key: append it to
     /home/$DEPLOY_USER/.ssh/authorized_keys as a single line prefixed with
       command="$APP_DIR/app/infra/vps/deploy.sh \$SSH_ORIGINAL_COMMAND",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty
     followed by the public key. sshd expands \$SSH_ORIGINAL_COMMAND to
     whatever the CI ssh call passes as its trailing command (the
     "<sha> <api-image> <web-image>" args) — the client can never get an
     interactive shell or run anything else, even though $DEPLOY_USER is in
     the docker group (effectively root-equivalent on this host).
  3. Add DEPLOY_SSH_HOST / DEPLOY_SSH_USER=$DEPLOY_USER / DEPLOY_SSH_KEY as
     GitHub Actions secrets.
  4. Schedule infra/vps/backup.sh (cron/systemd timer, nightly).
EOF
