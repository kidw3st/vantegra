const crypto = require('crypto');
const db = require('../database');

const DEFAULT_TTL_DAYS = 90;

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function newId() {
  return crypto.randomBytes(16).toString('hex');
}

function addDaysISO(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString();
}

function requestOrigin(req, fallbackHost) {
  const site = process.env.PUBLIC_SITE_ORIGIN;
  if (site) return String(site).replace(/\/$/, '');
  const hostHeader = (req && req.get && (req.get('x-forwarded-host') || req.get('host'))) || fallbackHost || 'crm-seo-123.xyz';
  const host = String(hostHeader).split(',')[0].trim().split(':')[0] || fallbackHost || 'crm-seo-123.xyz';
  const xf = (req && req.get && req.get('x-forwarded-proto')) || '';
  const xfProto = String(xf).split(',')[0].trim().toLowerCase();
  const isLocal = /^(localhost|127\.0\.0\.1)$/i.test(host);
  const proto = xfProto === 'https' || xfProto === 'http' ? xfProto : (isLocal ? 'http' : 'https');
  return `${proto}://${host}`;
}

function portalUrl(token, req) {
  if (!token) return '';
  return `${requestOrigin(req)}/c/${encodeURIComponent(token)}`;
}

function isExpired(iso) {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < Date.now();
}

function isRevoked(iso) {
  return !!(iso && String(iso).trim());
}

function getActiveLinkByProject(projectId) {
  return db.prepare(`
    SELECT * FROM client_access_links
    WHERE project_id = ? AND IFNULL(revoked_at,'') = ''
    ORDER BY created_at DESC LIMIT 1
  `).get(projectId);
}

function getLinkByToken(token) {
  if (!token || String(token).length < 16) return null;
  const live = db.prepare(`
    SELECT *, 0 AS is_preview FROM client_access_links WHERE token = ? LIMIT 1
  `).get(token);
  if (live) return live;
  const preview = db.prepare(`
    SELECT *, 1 AS is_preview FROM client_access_links
    WHERE IFNULL(preview_token,'') != '' AND preview_token = ? LIMIT 1
  `).get(token);
  if (preview) return preview;
  const project = db.prepare(`
    SELECT * FROM projects
    WHERE client_token = ? OR client_preview_token = ?
    LIMIT 1
  `).get(token, token);
  if (!project) return null;
  const isPreview = project.client_preview_token && project.client_preview_token === token ? 1 : 0;
  return {
    id: 'legacy-' + project.id,
    project_id: project.id,
    client_id: project.client_id || '',
    token: project.client_token,
    preview_token: project.client_preview_token || '',
    scope: 'view_and_edit_site',
    expires_at: project.client_token_expires_at || null,
    revoked_at: project.client_token_revoked_at || '',
    is_preview: isPreview
  };
}

function ensureLink(projectId, { regenerate = false, createdBy = '' } = {}) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) return null;
  let link = getActiveLinkByProject(projectId);
  if (link && !regenerate) {
    if (!link.preview_token) {
      const preview = newToken();
      db.prepare('UPDATE client_access_links SET preview_token = ? WHERE id = ?').run(preview, link.id);
      link.preview_token = preview;
    }
    return link;
  }
  if (link && regenerate) {
    db.prepare(`
      UPDATE client_access_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(link.id);
  }
  const token = newToken();
  const preview = newToken();
  const expires = addDaysISO(DEFAULT_TTL_DAYS);
  const id = newId();
  db.prepare(`
    INSERT INTO client_access_links
      (id, project_id, client_id, token, preview_token, scope, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, 'view_and_edit_site', ?, ?, CURRENT_TIMESTAMP)
  `).run(id, projectId, project.client_id || '', token, preview, expires, createdBy || '');
  db.prepare(`
    UPDATE projects SET
      client_token = ?, client_preview_token = ?, client_portal_enabled = 1,
      client_token_expires_at = ?, client_token_revoked_at = '',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(token, preview, expires, projectId);
  return db.prepare('SELECT * FROM client_access_links WHERE id = ?').get(id);
}

function revokeLink(projectId) {
  db.prepare(`
    UPDATE client_access_links SET revoked_at = CURRENT_TIMESTAMP
    WHERE project_id = ? AND IFNULL(revoked_at,'') = ''
  `).run(projectId);
  db.prepare(`
    UPDATE projects SET client_portal_enabled = 0, client_token_revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(projectId);
}

function touchLink(link) {
  if (!link || link.is_preview) return;
  const nextExpiry = addDaysISO(DEFAULT_TTL_DAYS);
  db.prepare(`
    UPDATE client_access_links SET last_used_at = CURRENT_TIMESTAMP, expires_at = ? WHERE id = ?
  `).run(nextExpiry, link.id);
}

function linkUsable(link) {
  if (!link) return { ok: false, error: 'Ссылка недействительна' };
  if (isRevoked(link.revoked_at)) return { ok: false, error: 'Ссылка отозвана' };
  if (isExpired(link.expires_at)) return { ok: false, error: 'Срок ссылки истёк' };
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(link.project_id);
  if (!project || !project.client_portal_enabled) {
    return { ok: false, error: 'Ссылка отключена или не найдена' };
  }
  return { ok: true, project, link };
}

function payload(project, req) {
  const link = getActiveLinkByProject(project.id);
  const token = (link && link.token) || project.client_token || '';
  const preview = (link && link.preview_token) || project.client_preview_token || '';
  return {
    enabled: !!project.client_portal_enabled,
    stats_enabled: project.client_stats_enabled === undefined || project.client_stats_enabled === null
      ? true
      : !!project.client_stats_enabled,
    site_url: project.client_site_url || '',
    token,
    previewToken: preview,
    expires_at: (link && link.expires_at) || project.client_token_expires_at || '',
    revoked: !!(project.client_token_revoked_at || (link && link.revoked_at)),
    url: token ? portalUrl(token, req) : '',
    previewUrl: preview ? portalUrl(preview, req) : ''
  };
}

module.exports = {
  DEFAULT_TTL_DAYS,
  newToken,
  portalUrl,
  requestOrigin,
  getActiveLinkByProject,
  getLinkByToken,
  ensureLink,
  revokeLink,
  touchLink,
  linkUsable,
  payload,
  isExpired,
  isRevoked
};