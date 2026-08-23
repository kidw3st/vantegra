#!/bin/bash
set -euo pipefail
echo '=== services ==='
systemctl is-active crm postgresql@16-main nginx php8.3-fpm || true
echo '=== enabled ==='
systemctl is-enabled crm postgresql nginx php8.3-fpm docker.service 2>/dev/null || true
echo '=== mem ==='
free -h
echo '=== http ==='
curl -sS -o /dev/null -w 'site:%{http_code}\n' http://127.0.0.1/
curl -sS -o /dev/null -w 'login:%{http_code}\n' http://127.0.0.1/pages/login.html
curl -sS -o /dev/null -w 'cabinet:%{http_code}\n' http://127.0.0.1/cabinet.html
echo '=== listen ==='
ss -tlnp | grep -E ':80|:3005|:5432|:8088|:22' || true
echo '=== cron ==='
crontab -l 2>/dev/null || echo NO_ROOT_CRON
ls /etc/cron.d 2>/dev/null || true
echo '=== backups ==='
ls -lh /opt/vantegra/backups 2>/dev/null || true
echo '=== env keys ==='
cut -d= -f1 /var/www/crm-app/.env 2>/dev/null || true
echo '=== pg counts ==='
su - postgres -c "psql -d vantegra -Atc 'SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM projects; SELECT COUNT(*) FROM tasks;'"
echo CHECK_OK
