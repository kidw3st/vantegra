/**
 * AdminVPS (WHMCS + ModulesGarden DNSManager2) — captcha login + DNS zone CRUD.
 * Secrets never logged.
 */
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const DEFAULT_BASE = 'https://my.adminvps.ru';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CRM-WebAgency/1.2.7';
const DEBUG_DIR = path.join(__dirname, 'data');

function ensureDebugDir() {
  try { fs.mkdirSync(DEBUG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

function saveDebug(name, content) {
  try {
    ensureDebugDir();
    const file = path.join(DEBUG_DIR, name);
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    return file;
  } catch (e) {
    return '';
  }
}

/** In-memory captcha sessions */
const captchaSessions = new Map();
/** Logged-in client sessions: integrationId → { jar, base, zoneId, createdAt, records } */
const clientSessions = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
const CLIENT_TTL_MS = 45 * 60 * 1000;

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of captchaSessions) {
    if (now - (s.createdAt || 0) > SESSION_TTL_MS) captchaSessions.delete(id);
  }
  for (const [id, s] of clientSessions) {
    if (now - (s.createdAt || 0) > CLIENT_TTL_MS) clientSessions.delete(id);
  }
}

function saveClientSession(integrationId, { jar, base, zoneId, records }) {
  if (!integrationId) return;
  clientSessions.set(String(integrationId), {
    jar: { ...(jar || {}) },
    base,
    zoneId: String(zoneId || ''),
    records: Array.isArray(records) ? records : [],
    createdAt: Date.now()
  });
}

function getClientSession(integrationId) {
  pruneSessions();
  return clientSessions.get(String(integrationId)) || null;
}

function clearClientSession(integrationId) {
  clientSessions.delete(String(integrationId));
}

function request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      headers: { ...headers },
      timeout: 25000
    };
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          setCookie: res.headers['set-cookie'] || [],
          buffer: buf,
          text: buf.toString('utf8'),
          location: res.headers.location || ''
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (body) req.write(body);
    req.end();
  });
}

function mergeCookies(jar, setCookie) {
  for (const line of setCookie || []) {
    const part = String(line).split(';')[0];
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    jar[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

function extractToken(html) {
  const patterns = [
    /name=["']token["']\s+value=["']([^"']+)["']/i,
    /name=["']csrf_token["']\s+value=["']([^"']+)["']/i,
    /value=["']([^"']+)["']\s+name=["']token["']/i,
    /"csrfToken"\s*:\s*"([^"]+)"/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  return '';
}

function extractCaptchaSrc(html, base) {
  const patterns = [
    /src=["']([^"']*verifyimage\.php[^"']*)["']/i,
    /src=["']([^"']*captcha[^"']*\.(?:php|png|jpg|jpeg|gif)[^"']*)["']/i,
    /src=["']([^"']*includes\/[^"']*image[^"']*)["']/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try { return new URL(m[1], base).toString(); } catch (e) { return m[1]; }
    }
  }
  return new URL('/includes/verifyimage.php', base).toString();
}

function captchaFieldName(html) {
  if (/name=["']code["']/i.test(html)) return 'code';
  if (/name=["']captcha["']/i.test(html)) return 'captcha';
  if (/name=["']captchavalue["']/i.test(html)) return 'captchavalue';
  return 'code';
}

function looksLoggedIn(html, status, location) {
  const h = String(html || '').toLowerCase();
  const loc = String(location || '').toLowerCase();
  if (loc.includes('clientarea') || loc.includes('dnsmanager')) return true;
  if (h.includes('clientarea.php') && (h.includes('выход') || h.includes('logout') || h.includes('выйти'))) return true;
  if (h.includes('dnsmanager2') && !h.includes('войдите в аккаунт')) return true;
  if (status >= 200 && status < 400 && (h.includes('мои услуги') || h.includes('services'))) return true;
  return false;
}

function extractLoginAction(html, base) {
  const m = html.match(/<form[^>]*class=["'][^"']*login[^"']*["'][^>]*action=["']([^"']+)["']/i)
    || html.match(/<form[^>]*action=["']([^"']+)["'][^>]*class=["'][^"']*login[^"']*["']/i)
    || html.match(/<form[^>]*action=["']([^"']*login[^"']*)["'][^>]*>/i);
  if (m) {
    try { return new URL(m[1], base).toString(); } catch (e) { /* fallthrough */ }
  }
  return base + '/login';
}

async function loadLoginPage(base) {
  const jar = {};
  // AdminVPS form action = /login (не dologin.php)
  const loginUrls = [
    base + '/login',
    base + '/index.php?rp=/login',
    base + '/clientarea.php'
  ];
  let html = '';
  let referer = loginUrls[0];
  let action = base + '/login';
  for (const url of loginUrls) {
    const page = await request('GET', url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: cookieHeader(jar) }
    });
    mergeCookies(jar, page.setCookie);
    html = page.text || html;
    referer = url;
    if (extractToken(html) || /name=["']password["']/i.test(html)) {
      action = extractLoginAction(html, base);
      break;
    }
    if (page.status >= 300 && page.location) {
      const next = new URL(page.location, base).toString();
      const r2 = await request('GET', next, {
        headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) }
      });
      mergeCookies(jar, r2.setCookie);
      html = r2.text || html;
      referer = next;
      if (extractToken(html) || /name=["']password["']/i.test(html)) {
        action = extractLoginAction(html, base);
        break;
      }
    }
  }
  return { jar, html, referer, action };
}

async function fetchCaptcha({ baseUrl } = {}) {
  pruneSessions();
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const { jar, html, referer, action } = await loadLoginPage(base);
  const token = extractToken(html);
  const field = captchaFieldName(html);
  // один запрос картинки — повторный перегенерирует код в сессии WHMCS
  const imgUrl = extractCaptchaSrc(html, base);
  const img = await request('GET', imgUrl, {
    headers: {
      'User-Agent': UA,
      Accept: 'image/png,image/*;q=0.8,*/*;q=0.5',
      Cookie: cookieHeader(jar),
      Referer: referer
    }
  });
  mergeCookies(jar, img.setCookie);

  const ctype = String(img.headers['content-type'] || 'image/png').split(';')[0];
  if (!img.buffer || img.buffer.length < 40) {
    return { ok: false, err: 'Не удалось загрузить картинку капчи' };
  }
  const sessionId = crypto.randomBytes(16).toString('hex');
  captchaSessions.set(sessionId, {
    jar: { ...jar },
    token,
    field,
    referer,
    action: action || (base + '/login'),
    base,
    createdAt: Date.now()
  });
  return {
    ok: true,
    sessionId,
    field,
    image: 'data:' + ctype + ';base64,' + img.buffer.toString('base64'),
    expiresInSec: Math.floor(SESSION_TTL_MS / 1000)
  };
}

async function login({ baseUrl, email, password, captchaCode, captchaSessionId }) {
  const base = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  if (!email || !password) return { ok: false, err: 'Нужны email и пароль' };

  pruneSessions();
  let jar = {};
  let token = '';
  let referer = base + '/login';
  let action = base + '/login';
  let field = 'code';
  let html = '';

  if (captchaSessionId && captchaSessions.has(captchaSessionId)) {
    const s = captchaSessions.get(captchaSessionId);
    jar = { ...s.jar };
    token = s.token || '';
    referer = s.referer || referer;
    action = s.action || action;
    field = s.field || 'code';
  } else {
    const page = await loadLoginPage(base);
    jar = page.jar;
    html = page.html;
    referer = page.referer;
    action = page.action || action;
    token = extractToken(html);
    field = captchaFieldName(html);
  }

  // WHMCS капча обычно в верхнем регистре
  const code = captchaCode ? String(captchaCode).trim().replace(/\s+/g, '').toUpperCase() : '';

  const body = new URLSearchParams();
  body.set('username', email);
  body.set('password', password);
  if (token) body.set('token', token);
  body.set('rememberme', 'on');
  if (code) body.set(field, code);

  const postTargets = [
    action,
    base + '/login',
    base + '/dologin.php',
    base + '/index.php?rp=/dologin'
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  let post = null;
  for (const url of postTargets) {
    post = await request('POST', url, {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(jar),
        Referer: referer,
        Origin: base,
        Accept: 'text/html,application/xhtml+xml'
      },
      body: body.toString()
    });
    mergeCookies(jar, post.setCookie);
    // если сразу логин/редирект в кабинет — ок; если 404 — пробуем следующий
    if (post.status !== 404) break;
  }

  let finalHtml = (post && post.text) || '';
  let location = (post && post.location) || '';
  let status = (post && post.status) || 0;

  // follow redirects (до 5)
  for (let hop = 0; hop < 5 && status >= 300 && status < 400 && location; hop++) {
    const abs = new URL(location, base).toString();
    const fol = await request('GET', abs, {
      headers: { 'User-Agent': UA, Cookie: cookieHeader(jar), Referer: referer }
    });
    mergeCookies(jar, fol.setCookie);
    finalHtml = fol.text || finalHtml;
    location = fol.location || '';
    status = fol.status;
    if (looksLoggedIn(finalHtml, status, location)) break;
  }

  const ca = await request('GET', base + '/clientarea.php', {
    headers: { 'User-Agent': UA, Cookie: cookieHeader(jar) }
  });
  mergeCookies(jar, ca.setCookie);

  if (looksLoggedIn(ca.text, ca.status, ca.location) || looksLoggedIn(finalHtml, status, location)) {
    if (captchaSessionId) captchaSessions.delete(captchaSessionId);
    return { ok: true, cookies: jar, captcha: false };
  }

  const combined = finalHtml + '\n' + (ca.text || '');
  const needCaptcha = /verifyimage|captcha|картинки|name=["']code["']/i.test(combined + html)
    || /символ|совпадают с изображен/i.test(combined)
    || (!code && /name=["']code["']/i.test(html));

  if (needCaptcha && !code) {
    return { ok: false, captcha: true, err: 'Введите код с картинки' };
  }

  const errMatch = combined.match(/alert[- ]danger[^>]*>([^<]+)/i)
    || combined.match(/Login Details Incorrect/i)
    || combined.match(/неверн[^<]{0,80}/i)
    || combined.match(/символ[а-я]*[^.<]{0,80}/i)
    || combined.match(/invalid captcha/i);
  return {
    ok: false,
    captcha: true,
    err: errMatch ? String(errMatch[1] || errMatch[0]).trim().slice(0, 160) : 'Вход не удался (проверьте email/пароль/капчу)'
  };
}

/* ========== DNSManager2 (ModulesGarden) ========== */

function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function fieldToData(type, field) {
  const f = field && typeof field === 'object' ? field : {};
  const t = String(type || '').toUpperCase();
  if (t === 'A' || t === 'AAAA') return String(f.address || f.ip || Object.values(f)[0] || '');
  if (t === 'MX') return [f.preference, f.exchange].filter(v => v != null && v !== '').join(' ');
  if (t === 'TXT') return String(f.txtdata || f.txt || Object.values(f)[0] || '');
  if (t === 'CNAME') return String(f.cname || f.target || Object.values(f)[0] || '');
  if (t === 'NS') return String(f.nsdname || f.ns || Object.values(f)[0] || '');
  if (t === 'SRV') return [f.priority, f.weight, f.port, f.target].filter(v => v != null && v !== '').join(' ');
  if (t === 'CAA') return [f.flag, f.tag, f.value].filter(v => v != null && v !== '').join(' ');
  const vals = Object.values(f).filter(v => v != null && v !== '');
  return vals.join(' ');
}

function dataToField(type, data) {
  const t = String(type || 'A').toUpperCase();
  const d = String(data || '').trim();
  if (t === 'A' || t === 'AAAA') return { address: d };
  if (t === 'MX') {
    const parts = d.split(/\s+/);
    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      return { preference: parts[0], exchange: parts.slice(1).join(' ') };
    }
    return { preference: '10', exchange: d };
  }
  if (t === 'TXT') return { txtdata: d };
  if (t === 'CNAME') return { cname: d };
  if (t === 'NS') return { nsdname: d };
  if (t === 'SRV') {
    const p = d.split(/\s+/);
    return { priority: p[0] || '0', weight: p[1] || '0', port: p[2] || '0', target: p[3] || '' };
  }
  return { address: d };
}

/** Parse ModulesGarden editZone table: record[N][name], record[N][field][address], … */
function parseMgZoneRecords(html) {
  const byIdx = {};
  const re = /name=["']record\[(\d+)\]((?:\[[^\]]+\])+)["'][^>]*?value=["']([^"']*)["']/gi;
  const re2 = /value=["']([^"']*)["'][^>]*?name=["']record\[(\d+)\]((?:\[[^\]]+\])+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    applyPath(byIdx, m[1], m[2], decodeEntities(m[3]));
  }
  while ((m = re2.exec(html))) {
    applyPath(byIdx, m[2], m[3], decodeEntities(m[1]));
  }

  const idxs = Object.keys(byIdx).map(Number).sort((a, b) => a - b);
  return idxs.map((i) => {
    const r = byIdx[i] || {};
    const type = String(r.type || 'A').toUpperCase();
    const field = r.field && typeof r.field === 'object' ? r.field : {};
    const data = fieldToData(type, field);
    const line = r.line || `${r.name || ''}|${type}|0`;
    return {
      id: String(line),
      line: String(line),
      index: i,
      name: String(r.name || '@'),
      type,
      ttl: String(r.ttl || '3600'),
      data,
      field,
      class: 'IN'
    };
  }).filter(r => r.type);
}

function applyPath(byIdx, idx, bracketPath, value) {
  const keys = [...String(bracketPath).matchAll(/\[([^\]]+)\]/g)].map(x => x[1]);
  if (!keys.length) return;
  byIdx[idx] = byIdx[idx] || {};
  let cur = byIdx[idx];
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keys[keys.length - 1]] = value;
}

function parseJsonResponse(text) {
  const start = text.indexOf('JSONRESPONSE#');
  if (start < 0) return null;
  const end = text.indexOf('#ENDJSONRESPONSE', start);
  const jsonStr = end > start
    ? text.slice(start + 'JSONRESPONSE#'.length, end)
    : text.slice(start + 'JSONRESPONSE#'.length);
  try {
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    return null;
  }
}

/** ModulesGarden AJAX: POST index.php?m=DNSManager2&json=1 with mg-action in body */
async function mgRequest(base, jar, action, fields, { zoneId } = {}) {
  const url = `${base}/index.php?m=DNSManager2&json=1`;
  const referer = `${base}/index.php?m=DNSManager2&mg-action=editZone&zone_id=${encodeURIComponent(zoneId || '')}`;
  const body = new URLSearchParams();
  body.set('mg-action', action);
  if (zoneId) body.set('zone_id', String(zoneId));
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null) continue;
    body.set(k, String(v));
  }
  const res = await request('POST', url, {
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Cookie: cookieHeader(jar),
      Referer: referer,
      Origin: base,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: '*/*'
    },
    body: body.toString()
  });
  mergeCookies(jar, res.setCookie);
  const parsed = parseJsonResponse(res.text || '');
  const low = (res.text || '').toLowerCase();
  if (res.status >= 300 && String(res.location || '').includes('login')) {
    return { ok: false, needLogin: true, err: 'Сессия истекла' };
  }
  if (low.includes('войдите в аккаунт') && !parsed) {
    return { ok: false, needLogin: true, err: 'Сессия истекла' };
  }
  return {
    ok: !!(parsed && (parsed.success !== false)),
    status: res.status,
    parsed,
    refreshHtml: parsed && parsed.data && parsed.data.refresh_html ? parsed.data.refresh_html : '',
    errors: parsed && parsed.data && parsed.data.errors ? parsed.data.errors : [],
    raw: (res.text || '').slice(0, 500)
  };
}

function recordsToFormFields(records) {
  const fields = {};
  (records || []).forEach((r, i) => {
    const type = String(r.type || 'A').toUpperCase();
    const field = r.field && typeof r.field === 'object' && Object.keys(r.field).length
      ? r.field
      : dataToField(type, r.data);
    fields[`record[${i}][name]`] = r.name || '@';
    fields[`record[${i}][type]`] = type;
    fields[`record[${i}][ttl]`] = String(r.ttl || '3600');
    fields[`record[${i}][line]`] = r.line || `${r.name || ''}|${type}|0`;
    for (const [fk, fv] of Object.entries(field)) {
      fields[`record[${i}][field][${fk}]`] = fv;
    }
  });
  return fields;
}

async function fetchZonePage(base, jar, zoneId) {
  const zoneUrl = `${base}/index.php?m=DNSManager2&mg-action=editZone&zone_id=${encodeURIComponent(zoneId)}`;
  const page = await request('GET', zoneUrl, {
    headers: {
      'User-Agent': UA,
      Cookie: cookieHeader(jar || {}),
      Accept: 'text/html,*/*',
      Referer: `${base}/clientarea.php`
    }
  });
  mergeCookies(jar, page.setCookie);
  return { page, zoneUrl };
}

async function loadZoneRecords({ base, jar, zoneId }) {
  const zid = String(zoneId || '').trim();
  if (!zid) return { ok: false, err: 'Нет zone_id' };

  const { page, zoneUrl } = await fetchZonePage(base, jar, zid);
  let html = page.text || '';
  const low = html.toLowerCase();

  if (page.status >= 300 && page.location && String(page.location).includes('login')) {
    return { ok: false, err: 'Сессия истекла — войдите снова', needLogin: true };
  }
  if (low.includes('войдите в аккаунт') && !low.includes('dnsmanager')) {
    return { ok: false, err: 'Сессия истекла — войдите снова', needLogin: true };
  }

  let records = parseMgZoneRecords(html);

  // fallback: json=1 editZone → refresh_html
  if (!records.length) {
    const jr = await mgRequest(base, jar, 'editZone', {}, { zoneId: zid });
    if (jr.needLogin) return jr;
    if (jr.refreshHtml) {
      html = jr.refreshHtml;
      records = parseMgZoneRecords(html);
    }
  }

  saveDebug(`adminvps-zone-${zid}.html`, html);
  saveDebug(`adminvps-meta-${zid}.json`, {
    recordsFound: records.length,
    sample: records.slice(0, 3),
    savedAt: new Date().toISOString()
  });

  return {
    ok: true,
    records,
    source: 'mg-form',
    zoneUrl,
    rawHint: records.length ? '' : 'Записи не найдены в зоне'
  };
}

async function checkDnsZone({
  baseUrl, email, password, zoneId, captchaCode, captchaSessionId, integrationId
}) {
  const loginRes = await login({ baseUrl, email, password, captchaCode, captchaSessionId });
  if (!loginRes.ok) return loginRes;

  const base = String(baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const zid = String(zoneId || '').trim();
  if (!zid) {
    if (integrationId) saveClientSession(integrationId, { jar: loginRes.cookies, base, zoneId: '', records: [] });
    return { ok: true, message: 'Вход OK (zone_id не задан)', cookies: loginRes.cookies, records: [] };
  }

  const zone = await loadZoneRecords({ base, jar: loginRes.cookies, zoneId: zid });
  if (zone.needLogin) return { ok: false, err: zone.err, needLogin: true };
  if (!zone.ok) return { ok: false, err: zone.err || 'Не удалось загрузить зону' };

  if (integrationId) {
    saveClientSession(integrationId, {
      jar: loginRes.cookies,
      base,
      zoneId: zid,
      records: zone.records
    });
  }

  return {
    ok: true,
    message: `Вход OK · DNS записей: ${zone.records.length}`,
    zoneId: zid,
    records: zone.records,
    source: zone.source,
    rawHint: zone.rawHint || ''
  };
}

async function getZoneWithSession(integrationId, { baseUrl, zoneId, force } = {}) {
  pruneSessions();
  const sess = getClientSession(integrationId);
  const base = String((sess && sess.base) || baseUrl || DEFAULT_BASE).replace(/\/$/, '');
  const zid = String(zoneId || (sess && sess.zoneId) || '').trim();
  if (!sess || !sess.jar) {
    return { ok: false, needLogin: true, err: 'Сначала войдите (капча)' };
  }
  if (!force && sess.records && sess.records.length && String(sess.zoneId) === zid) {
    return { ok: true, records: sess.records, cached: true, zoneId: zid };
  }
  const zone = await loadZoneRecords({ base, jar: sess.jar, zoneId: zid });
  if (zone.needLogin) {
    clearClientSession(integrationId);
    return zone;
  }
  if (zone.ok) {
    saveClientSession(integrationId, { jar: sess.jar, base, zoneId: zid, records: zone.records });
  }
  return zone;
}

/**
 * action: add | edit | remove
 */
async function mutateRecord(integrationId, { action, record, zoneId }) {
  const sess = getClientSession(integrationId);
  if (!sess || !sess.jar) return { ok: false, needLogin: true, err: 'Сначала войдите (капча)' };
  const base = sess.base;
  const zid = String(zoneId || sess.zoneId || '').trim();
  if (!zid) return { ok: false, err: 'Нет zone_id' };

  const zone = await loadZoneRecords({ base, jar: sess.jar, zoneId: zid });
  if (zone.needLogin) {
    clearClientSession(integrationId);
    return zone;
  }
  if (!zone.ok) return { ok: false, err: zone.err || 'Не удалось загрузить зону' };

  let list = zone.records.slice();
  const r = record || {};
  const type = String(r.type || 'A').toUpperCase();
  const name = r.name || '@';
  const ttl = String(r.ttl || '3600');
  const data = r.data != null ? String(r.data) : '';
  const field = dataToField(type, data);

  if (action === 'add') {
    list.push({
      name, type, ttl, data, field,
      line: `${name}|${type}|0`
    });
    const fields = recordsToFormFields(list);
    const res = await mgRequest(base, sess.jar, 'editZoneSave', fields, { zoneId: zid });
    if (res.needLogin) {
      clearClientSession(integrationId);
      return res;
    }
    // also try addNewRecordSave if editZoneSave failed
    if (res.errors && res.errors.length) {
      const addFields = {
        'record[0][name]': name,
        'record[0][type]': type,
        'record[0][ttl]': ttl,
        ...Object.fromEntries(Object.entries(field).map(([k, v]) => [`record[0][field][${k}]`, v]))
      };
      const res2 = await mgRequest(base, sess.jar, 'addNewRecordSave', addFields, { zoneId: zid });
      if (res2.needLogin) {
        clearClientSession(integrationId);
        return res2;
      }
    }
  } else if (action === 'edit') {
    const line = String(r.line || r.id || '');
    const idx = list.findIndex(x => String(x.line) === line || String(x.id) === line || String(x.index) === line);
    if (idx < 0) return { ok: false, err: 'Запись не найдена: ' + line };
    list[idx] = {
      ...list[idx],
      name, type, ttl, data, field,
      line: list[idx].line || `${name}|${type}|0`
    };
    const fields = recordsToFormFields(list);
    const res = await mgRequest(base, sess.jar, 'editZoneSave', fields, { zoneId: zid });
    if (res.needLogin) {
      clearClientSession(integrationId);
      return res;
    }
    if (res.errors && res.errors.length) {
      return { ok: false, err: stripTags(JSON.stringify(res.errors)).slice(0, 200) };
    }
  } else if (action === 'remove') {
    const line = String(r.line || r.id || '');
    const idx = list.findIndex(x => String(x.line) === line || String(x.id) === line || String(x.index) === line);
    if (idx < 0) return { ok: false, err: 'Запись не найдена: ' + line };
    const victim = list[idx];
    const fields = {
      [`record[${idx}][name]`]: victim.name,
      [`record[${idx}][type]`]: victim.type,
      [`record[${idx}][ttl]`]: victim.ttl,
      [`record[${idx}][line]`]: victim.line
    };
    const vf = victim.field || dataToField(victim.type, victim.data);
    for (const [fk, fv] of Object.entries(vf)) {
      fields[`record[${idx}][field][${fk}]`] = fv;
    }
    const res = await mgRequest(base, sess.jar, 'removeRecord', fields, { zoneId: zid });
    if (res.needLogin) {
      clearClientSession(integrationId);
      return res;
    }
    if (res.errors && res.errors.length) {
      return { ok: false, err: stripTags(JSON.stringify(res.errors)).slice(0, 200) };
    }
  } else {
    return { ok: false, err: 'Неизвестное действие' };
  }

  const refreshed = await loadZoneRecords({ base, jar: sess.jar, zoneId: zid });
  if (refreshed.ok) {
    saveClientSession(integrationId, { jar: sess.jar, base, zoneId: zid, records: refreshed.records });
  }
  return {
    ok: true,
    message: action === 'remove' ? 'Удалено' : (action === 'add' ? 'Добавлено' : 'Сохранено'),
    records: refreshed.records || []
  };
}

module.exports = {
  login,
  checkDnsZone,
  fetchCaptcha,
  getZoneWithSession,
  mutateRecord,
  getClientSession,
  clearClientSession,
  parseMgZoneRecords,
  DEFAULT_BASE
};
