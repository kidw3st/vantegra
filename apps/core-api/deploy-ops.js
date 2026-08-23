/**
 * Server deploy / GitHub pull helpers (SSH via ssh2).
 * Secrets come from vault-decrypted integration config — never logged.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

function sshExec(conn, cmd, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { timeout: timeoutMs }, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('data', d => { out += d.toString(); });
      stream.stderr.on('data', d => { errOut += d.toString(); });
      stream.on('close', code => resolve({ code, out, errOut }));
    });
  });
}

function withSsh(cfg, fn) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      try { conn.end(); } catch (e) {}
      reject(new Error('SSH timeout'));
    }, cfg.timeoutMs || 120000);
    conn.on('ready', async () => {
      try {
        const result = await fn(conn);
        clearTimeout(timer);
        conn.end();
        resolve(result);
      } catch (e) {
        clearTimeout(timer);
        try { conn.end(); } catch (err) {}
        reject(e);
      }
    });
    conn.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    conn.connect({
      host: cfg.host,
      port: cfg.port || 22,
      username: cfg.username,
      password: cfg.password,
      readyTimeout: 20000
    });
  });
}

async function testConnection(cfg) {
  return withSsh(cfg, async (conn) => {
    const r = await sshExec(conn, 'echo OK && hostname && uptime', 15000);
    return { ok: r.code === 0, out: (r.out || '').trim(), err: r.errOut };
  });
}

async function backupRemoteDb(cfg) {
  const appDir = cfg.appDir || '/var/www/crm-app/server';
  const backupDir = cfg.backupDir || '/var/www/crm-app/backups';
  return withSsh(cfg, async (conn) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const cmd = `
set -e
mkdir -p "${backupDir}"
DB="${appDir}/crm.db"
if [ ! -f "$DB" ]; then echo "NO_DB"; exit 2; fi
cp -a "$DB" "${backupDir}/crm.db.before-deploy-${stamp}"
cp -a "$DB" "${backupDir}/crm.db.prev" 2>/dev/null || true
ls -la "${backupDir}/crm.db.before-deploy-${stamp}"
echo "BACKUP_OK ${backupDir}/crm.db.before-deploy-${stamp}"
`;
    const r = await sshExec(conn, cmd, 60000);
    const m = (r.out || '').match(/BACKUP_OK\s+(\S+)/);
    return { ok: r.code === 0 && !!m, path: m ? m[1] : '', out: r.out, err: r.errOut, code: r.code };
  });
}

function repoCloneUrl(repoUrl, token) {
  let url = repoUrl || 'https://github.com/AndrewF250/CRM.git';
  if (token && /^https:\/\//i.test(url)) {
    url = url.replace(/^https:\/\//i, `https://${encodeURIComponent(token)}@`);
  }
  return url;
}

async function deployFromGithub(cfg) {
  const appDir = cfg.appDir || '/var/www/crm-app/server';
  const backupDir = cfg.backupDir || '/var/www/crm-app/backups';
  const repo = repoCloneUrl(cfg.repoUrl || 'https://github.com/AndrewF250/CRM.git', cfg.githubToken);
  const branch = cfg.branch || 'main';
  return withSsh({ ...cfg, timeoutMs: 360000 }, async (conn) => {
    const backup = await (async () => {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const cmd = `
set -e
mkdir -p "${backupDir}"
DB="${appDir}/crm.db"
if [ -f "$DB" ]; then
  cp -a "$DB" "${backupDir}/crm.db.before-deploy-${stamp}"
  cp -a "$DB" "${backupDir}/crm.db.prev"
  echo "BACKUP_OK"
else
  echo "BACKUP_SKIP"
fi
`;
      return sshExec(conn, cmd, 60000);
    })();

    const deployCmd = `
set -e
export DEBIAN_FRONTEND=noninteractive
which git >/dev/null || apt-get install -y git
which rsync >/dev/null || apt-get install -y rsync
APP_DIR="${appDir}"
BACKUP_DIR="${backupDir}"
REPO_URL="${repo}"
BRANCH="${branch}"
TMP="/tmp/crm-deploy-$$"
rm -rf "$TMP"
git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$TMP"
mkdir -p "$APP_DIR" "$BACKUP_DIR"
# Keep DB + uploads
rsync -a --delete \\
  --exclude 'crm.db' --exclude 'crm.db-*' --exclude 'uploads/' --exclude 'node_modules/' \\
  --exclude '.vault-key' --exclude '*.db-wal' --exclude '*.db-shm' \\
  "$TMP/server/" "$APP_DIR/"
# Product version lives in repo root
if [ -f "$TMP/VERSION" ]; then cp -f "$TMP/VERSION" "$APP_DIR/VERSION"; cp -f "$TMP/VERSION" "$(dirname "$APP_DIR")/VERSION" 2>/dev/null || true; fi
if [ -f "$TMP/CHANGELOG.md" ]; then cp -f "$TMP/CHANGELOG.md" "$APP_DIR/CHANGELOG.md"; fi
cd "$APP_DIR"
npm install --omit=dev
# Health: can node load database module?
node -e "require('./database'); console.log('DB_LOAD_OK')"
(systemctl restart crm >/dev/null 2>&1 && echo CRM_RESTARTED) || pm2 restart crm 2>/dev/null || pm2 start server.js --name crm || true
sleep 2
curl -sf http://127.0.0.1:3005/pages/login.html >/dev/null && echo HEALTH_OK || echo HEALTH_FAIL
rm -rf "$TMP"
`;
    const r = await sshExec(conn, deployCmd, 300000);
    const healthOk = /HEALTH_OK/.test(r.out || '');
    const dbOk = /DB_LOAD_OK/.test(r.out || '');
    if (!healthOk || !dbOk) {
      // attempt restore prev DB
      await sshExec(conn, `
if [ -f "${backupDir}/crm.db.prev" ]; then
  cp -a "${backupDir}/crm.db.prev" "${appDir}/crm.db"
  (systemctl restart crm >/dev/null 2>&1 && echo CRM_RESTARTED) || pm2 restart crm 2>/dev/null || true
  echo RESTORE_PREV_OK
fi
`, 60000);
      return {
        ok: false,
        backupOut: backup.out,
        out: r.out,
        err: r.errOut || 'Deploy health check failed; tried restore crm.db.prev',
        restored: true
      };
    }
    return { ok: true, backupOut: backup.out, out: r.out, err: r.errOut };
  });
}

async function restorePrevDb(cfg) {
  const appDir = cfg.appDir || '/var/www/crm-app/server';
  const backupDir = cfg.backupDir || '/var/www/crm-app/backups';
  return withSsh(cfg, async (conn) => {
    const r = await sshExec(conn, `
set -e
if [ ! -f "${backupDir}/crm.db.prev" ]; then echo NO_PREV; exit 2; fi
cp -a "${appDir}/crm.db" "${backupDir}/crm.db.before-restore-$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
cp -a "${backupDir}/crm.db.prev" "${appDir}/crm.db"
(systemctl restart crm >/dev/null 2>&1 && echo CRM_RESTARTED) || pm2 restart crm 2>/dev/null || true
echo RESTORE_OK
`, 60000);
    return { ok: r.code === 0 && /RESTORE_OK/.test(r.out || ''), out: r.out, err: r.errOut };
  });
}

/** Keep only previous DB as current (discard new) — same as restorePrevDb */
async function keepOnlyOldDb(cfg) {
  return restorePrevDb(cfg);
}

module.exports = {
  testConnection,
  backupRemoteDb,
  deployFromGithub,
  restorePrevDb,
  keepOnlyOldDb
};