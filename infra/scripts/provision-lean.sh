#!/usr/bin/env bash
# Idempotent lean-VPS setup. Does not touch OpenVPN, DNS, or SSH password auth.
set -euo pipefail

INFRA="${INFRA:-/opt/vantegra/infra}"
CRM_SRC="${CRM_SRC:-/tmp/vantegra-crm-server.js}"

echo "==> swap"
if ! swapon --show | grep -q .; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile || true
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
cat >/etc/sysctl.d/99-vantegra.conf <<'EOF'
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
sysctl -p /etc/sysctl.d/99-vantegra.conf >/dev/null

echo "==> journald"
mkdir -p /etc/systemd/journald.conf.d
install -m 644 "$INFRA/systemd/journald-vantegra.conf" /etc/systemd/journald.conf.d/vantegra.conf
systemctl restart systemd-journald || true

echo "==> systemd crm"
install -m 644 "$INFRA/systemd/crm.service" /etc/systemd/system/crm.service
systemctl daemon-reload

echo "==> nginx"
install -m 644 "$INFRA/nginx/vps-http.conf" /etc/nginx/sites-available/vantegracode.ru
nginx -t
systemctl reload nginx

echo "==> cron + backup"
install -m 755 "$INFRA/scripts/backup-pg.sh" "$INFRA/scripts/backup-pg.sh"
chmod 755 "$INFRA/scripts/backup-pg.sh" "$INFRA/postgres/migrate.sh" "$INFRA/postgres/check-vps.sh" || true
install -m 644 "$INFRA/cron/vantegra" /etc/cron.d/vantegra
chmod 644 /etc/cron.d/vantegra
install -m 644 "$INFRA/logrotate/crm" /etc/logrotate.d/vantegra

echo "==> disable idle docker (RAM)"
if systemctl list-unit-files | grep -q '^docker.service'; then
  systemctl disable --now docker.service docker.socket 2>/dev/null || true
fi
if command -v pm2 >/dev/null 2>&1; then
  pm2 kill >/dev/null 2>&1 || true
fi

echo "==> crm healthz source"
if [[ -f "$CRM_SRC" ]]; then
  install -m 644 "$CRM_SRC" /var/www/crm-app/server.js
fi

echo "==> enable + restart"
systemctl enable crm postgresql nginx php8.3-fpm >/dev/null 2>&1 || true
systemctl restart crm
sleep 2
systemctl is-active crm postgresql@16-main nginx php8.3-fpm

echo "==> first dump"
"$INFRA/scripts/backup-pg.sh"

echo "==> checks"
curl -sS -o /dev/null -w 'site:%{http_code}\n' http://127.0.0.1/
curl -sS -o /dev/null -w 'healthz:%{http_code}\n' http://127.0.0.1/healthz
curl -sS http://127.0.0.1/healthz || true
free -h
swapon --show || true
echo PROVISION_OK
