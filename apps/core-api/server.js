const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./database');
const { hashPassword, verifyPassword, isHashed } = require('./auth-passwords');
const vault = require('./vault');
const deployOps = require('./deploy-ops');
const appVersion = require('./app-version');
const tzUtil = require('./timezone');
const adminvpsOps = require('./adminvps-ops');
const rateLimit = require('./lib/rate-limit');
const portal = require('./lib/portal');
const sessionStore = require('./lib/sessions');
const clickhouse = require('./lib/clickhouse');
const queue = require('./lib/queue');

const app = express();
const PORT = process.env.PORT || 3005;
const STAFF_WEB = path.join(__dirname, '..', 'staff-web');
const CLIENT_PORTAL = path.join(__dirname, '..', 'client-portal');
const CABINET_FILE = path.join(CLIENT_PORTAL, 'pages', 'client-cabinet.html');

function sendCabinet(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(CABINET_FILE);
}

// Cloudflare / nginx proxies set X-Forwarded-* — needed for https links & cookies
app.set('trust proxy', 1);

function getAppTimezone() {
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get();
    return tzUtil.normalizeTz(row && row.value);
  } catch (e) {
    return tzUtil.DEFAULT_TZ;
  }
}

function setAppTimezone(tz) {
  const next = tzUtil.normalizeTz(tz);
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('timezone', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(next);
  return next;
}

/** Shift calendar dates when timezone day boundary changes */
function migrateDatesForTimezone(oldTz, newTz) {
  const delta = tzUtil.dayDelta(oldTz, newTz);
  if (!delta) return { delta: 0, updated: 0 };
  let updated = 0;
  const shiftCol = (table, col) => {
    try {
      const rows = db.prepare(`SELECT rowid AS rid, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} != ''`).all();
      const upd = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE rowid = ?`);
      for (const r of rows) {
        const next = tzUtil.shiftISODate(r.v, delta);
        if (next && next !== r.v) {
          upd.run(next, r.rid);
          updated++;
        }
      }
    } catch (e) {
      console.error('migrateDates', table, col, e.message);
    }
  };
  [
    ['tasks', 'date'],
    ['tasks', 'date_end'],
    ['projects', 'deadline'],
    ['projects', 'payment_due_date'],
    ['expenses', 'date'],
    ['expenses', 'next_date'],
    ['salaries', 'pay_date'],
    ['salaries', 'paid_date'],
    ['goals', 'date_start'],
    ['goals', 'date_end'],
    ['reminders', 'remind_date']
  ].forEach(([t, c]) => shiftCol(t, c));
  // salaries.month YYYY-MM from pay_date-ish: shift month string if looks like YYYY-MM
  try {
    const rows = db.prepare("SELECT id, month FROM salaries WHERE month IS NOT NULL AND month != ''").all();
    const upd = db.prepare('UPDATE salaries SET month = ? WHERE id = ?');
    for (const r of rows) {
      if (!/^\d{4}-\d{2}$/.test(r.month)) continue;
      const shifted = tzUtil.addDaysISO(r.month + '-15', delta);
      if (shifted) {
        const nm = shifted.slice(0, 7);
        if (nm !== r.month) {
          upd.run(nm, r.id);
          updated++;
        }
      }
    }
  } catch (e) {}
  return { delta, updated };
}

// Ensure uploads directory exists (multer fails with ENOENT otherwise)
const uploadsDir = path.join(__dirname, 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}

// Helper: make avatar initials from a name
function makeAvatar(name) {
  return (name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// Create sessions table if not exists
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Clean expired sessions on startup
db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

function generateToken() {
  return crypto.randomBytes(48).toString('hex');
}

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  Promise.resolve(sessionStore.get(token)).then((session) => {
    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = {
      id: session.user_id || session.id,
      username: session.username,
      name: session.name,
      role: session.role,
      avatar: session.avatar
    };
    next();
  }).catch((err) => {
    console.error('requireAuth', err);
    res.status(401).json({ error: 'Unauthorized' });
  });
}

// Log activity
function logActivity(projectId, taskId, userName, action, details = '') {
  try {
    db.prepare('INSERT INTO activity (project_id, task_id, user_name, action, details) VALUES (?, ?, ?, ?, ?)').run(projectId, taskId, userName, action, details);
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}

function userNotifPrefsByName(userName) {
  const u = db.prepare('SELECT * FROM users WHERE name = ? OR username = ?').get(userName, userName);
  if (!u) {
    return { reminders: true, deadlines: true, deadline_week: true, deadline_day: true, overdue: true };
  }
  const deadlines = u.notif_deadlines !== 0;
  return {
    reminders: u.notif_reminders !== 0,
    deadlines,
    deadline_week: u.notif_deadline_week === undefined || u.notif_deadline_week === null
      ? deadlines : u.notif_deadline_week !== 0,
    deadline_day: u.notif_deadline_day === undefined || u.notif_deadline_day === null
      ? deadlines : u.notif_deadline_day !== 0,
    overdue: u.notif_overdue !== 0
  };
}

function userAllowsNotif(userName, kind) {
  const p = userNotifPrefsByName(userName);
  if (kind === 'reminders') return p.reminders;
  if (kind === 'deadlines') return p.deadlines;
  if (kind === 'deadline_week') return p.deadline_week;
  if (kind === 'deadline_day') return p.deadline_day;
  if (kind === 'overdue') return p.overdue;
  return true;
}

// Create a notification for a user (skipped when the user changed their own task)
function notifyUser(userName, actor, action, message, taskId = null, projectId = null) {
  try {
    if (!userName || userName === actor) return;
    db.prepare('INSERT INTO notifications (user_name, actor, action, message, task_id, project_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userName, actor, action, message, taskId, projectId);
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
}

function notifyAllUsers(actor, action, message, projectId = null, kind = null) {
  try {
    const users = db.prepare('SELECT name FROM users').all();
    const ins = db.prepare(
      'INSERT INTO notifications (user_name, actor, action, message, task_id, project_id) VALUES (?, ?, ?, ?, ?, ?)'
    );
    users.forEach(u => {
      if (!u.name) return;
      if (kind && !userAllowsNotif(u.name, kind)) return;
      ins.run(u.name, actor || 'Система', action, message, null, projectId);
    });
  } catch (err) {
    console.error('Failed to notify all users:', err);
  }
}

function addDaysISO(dateStr, days) {
  return tzUtil.addDaysISO(dateStr, days);
}

function addMonthsISO(dateStr, months) {
  if (!dateStr) return '';
  const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1 + (Number(months) || 0), +m[3]));
  return dt.toISOString().slice(0, 10);
}

/** Normalize recur_interval: day|week|month|year|every:N:unit */
function normalizeRecurInterval(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'day' || s === 'week' || s === 'month' || s === 'year') return s;
  const m = s.match(/^every:(\d+):(day|week|month|year)$/);
  if (m) {
    const n = Math.max(1, parseInt(m[1], 10) || 1);
    return `every:${n}:${m[2]}`;
  }
  return 'month';
}

function computeNextExpenseDate(fromDate, interval) {
  const base = String(fromDate || '').slice(0, 10);
  if (!base) return '';
  const iv = normalizeRecurInterval(interval);
  if (iv === 'day') return addDaysISO(base, 1);
  if (iv === 'week') return addDaysISO(base, 7);
  if (iv === 'year') return addMonthsISO(base, 12);
  if (iv === 'month') return addMonthsISO(base, 1);
  const m = iv.match(/^every:(\d+):(day|week|month|year)$/);
  if (m) {
    const n = parseInt(m[1], 10) || 1;
    const unit = m[2];
    if (unit === 'day') return addDaysISO(base, n);
    if (unit === 'week') return addDaysISO(base, n * 7);
    if (unit === 'year') return addMonthsISO(base, n * 12);
    return addMonthsISO(base, n);
  }
  return addMonthsISO(base, 1);
}

/** Keep reminder rows for recurring expenses (remind 3 days before next_date). */
function syncExpenseReminders() {
  try {
    const recurring = db.prepare('SELECT * FROM expenses WHERE is_recurring = 1').all();
    const del = db.prepare(
      "DELETE FROM reminders WHERE expense_id = ? AND type = 'expense' AND is_sent = 0"
    );
    const ins = db.prepare(
      "INSERT INTO reminders (project_id, type, message, remind_date, expense_id, notified) VALUES (NULL, 'expense', ?, ?, ?, 0)"
    );
    for (const e of recurring) {
      let next = (e.next_date || e.date || '').slice(0, 10);
      if (!next) continue;
      const today = todayLocalISO();
      // If next_date already passed, roll forward
      let guard = 0;
      while (next < today && guard < 36) {
        next = computeNextExpenseDate(next, e.recur_interval || 'month');
        guard++;
      }
      if (next !== (e.next_date || '').slice(0, 10)) {
        db.prepare('UPDATE expenses SET next_date = ? WHERE id = ?').run(next, e.id);
      }
      const remindDate = addDaysISO(next, -3);
      del.run(e.id);
      if (!remindDate) continue;
      const label = [e.category, e.subcategory, e.description].filter(Boolean).join(' · ');
      const msg = `Повторяющийся расход: ${label} — ${e.amount}₽. Списание: ${next}`;
      ins.run(msg, remindDate, e.id);
    }
  } catch (err) {
    console.error('syncExpenseReminders failed:', err);
  }
}

/** Push in-app notifications once when expense reminder becomes due. */
function fireDueExpenseReminderNotifications() {
  try {
    const today = todayLocalISO();
    const due = db.prepare(`
      SELECT * FROM reminders
      WHERE type = 'expense' AND is_sent = 0 AND notified = 0 AND remind_date <= ?
    `).all(today);
    const mark = db.prepare('UPDATE reminders SET notified = 1 WHERE id = ?');
    due.forEach(r => {
      notifyAllUsers('Система', 'expense_reminder', r.message, null, 'reminders');
      mark.run(r.id);
    });
  } catch (err) {
    console.error('fireDueExpenseReminderNotifications failed:', err);
  }
}

function todayLocalISO() {
  return tzUtil.todayISO(getAppTimezone());
}

function parseDeadlineISO(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s || s === '—' || s === '-' || s === 'null') return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return '';
}

function deadlineNotifExists(userName, action, taskId, projectId, deadlineISO) {
  const row = db.prepare(`
    SELECT id FROM notifications
    WHERE user_name = ? AND action = ?
      AND IFNULL(task_id, '') = IFNULL(?, '')
      AND IFNULL(project_id, '') = IFNULL(?, '')
      AND message LIKE ?
    LIMIT 1
  `).get(userName, action, taskId || null, projectId || null, '%' + deadlineISO + '%');
  return !!row;
}

function notifyDeadline(userName, action, message, taskId, projectId, deadlineISO, kind = 'deadlines') {
  if (!userName) return;
  if (!userAllowsNotif(userName, kind)) return;
  if (deadlineNotifExists(userName, action, taskId, projectId, deadlineISO)) return;
  try {
    db.prepare(
      'INSERT INTO notifications (user_name, actor, action, message, task_id, project_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(userName, 'Система', action, message, taskId || null, projectId || null);
  } catch (err) {
    console.error('notifyDeadline failed:', err);
  }
}

/** Technical deadline warnings: 7 days and 1 day before task/project deadline. */
function fireDeadlineNotifications() {
  try {
    const today = todayLocalISO();
    const in1 = addDaysISO(today, 1);
    const in7 = addDaysISO(today, 7);

    const tasks = db.prepare(
      "SELECT id, name, person, date, date_end, done FROM tasks WHERE IFNULL(done, 0) = 0"
    ).all();
    for (const t of tasks) {
      const dl = parseDeadlineISO(t.date_end) || parseDeadlineISO(t.date);
      if (!dl || !t.person) continue;
      if (dl === in7) {
        notifyDeadline(
          t.person, 'deadline_week',
          `До дедлайна задачи «${t.name}» осталась неделя (${dl})`,
          t.id, null, dl, 'deadline_week'
        );
      }
      if (dl === in1) {
        notifyDeadline(
          t.person, 'deadline_day',
          `До дедлайна задачи «${t.name}» остался 1 день (${dl})`,
          t.id, null, dl, 'deadline_day'
        );
      }
      if (dl < today) {
        notifyDeadline(
          t.person, 'deadline_overdue',
          `Задача «${t.name}» просрочена (дедлайн ${dl})`,
          t.id, null, dl, 'overdue'
        );
      }
    }

    const projects = db.prepare(
      "SELECT id, name, deadline, assignee, status FROM projects"
    ).all();
    for (const p of projects) {
      if (p.status === 'Выполнено') continue;
      const dl = parseDeadlineISO(p.deadline);
      if (!dl || !p.assignee) continue;
      if (dl === in7) {
        notifyDeadline(
          p.assignee, 'deadline_week',
          `До дедлайна проекта «${p.name}» осталась неделя (${dl})`,
          null, p.id, dl, 'deadline_week'
        );
      }
      if (dl === in1) {
        notifyDeadline(
          p.assignee, 'deadline_day',
          `До дедлайна проекта «${p.name}» остался 1 день (${dl})`,
          null, p.id, dl, 'deadline_day'
        );
      }
      if (dl < today) {
        notifyDeadline(
          p.assignee, 'deadline_overdue',
          `Проект «${p.name}» просрочен (дедлайн ${dl})`,
          null, p.id, dl, 'overdue'
        );
      }
    }
  } catch (err) {
    console.error('fireDeadlineNotifications failed:', err);
  }
}

// Global change counter for realtime polling: bumped on every successful mutation
let changeVersion = Date.now();

app.get('/healthz', (req, res) => {
  try {
    db.prepare('SELECT 1 AS ok').get();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, db: process.env.DATABASE_URL ? 'postgres' : 'sqlite' });
  } catch (err) {
    res.status(503).json({ ok: false });
  }
});

// Middleware
app.use(cors());
app.use(express.json());

app.get('/pages/client.html', (req, res, next) => {
  const t = String(req.query.t || req.query.token || '').trim();
  if (!t) return next();
  const q = new URLSearchParams(req.query);
  q.delete('t');
  q.delete('token');
  const extra = q.toString();
  return res.redirect(301, `/c/${encodeURIComponent(t)}${extra ? '?' + extra : ''}`);
});
app.get('/c/:token/preview', sendCabinet);
app.get('/c/:token', sendCabinet);

app.use(express.static(STAFF_WEB));
app.use(express.static(CLIENT_PORTAL));

// Bump change version on successful data mutations (for realtime polling)
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.path.startsWith('/api') && !['/api/login', '/api/logout'].includes(req.path)) {
    res.on('finish', () => { if (res.statusCode < 400) changeVersion++; });
  }
  next();
});

// File upload (max 30 MB)
const UPLOAD_MAX_BYTES = 30 * 1024 * 1024;
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 20);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: UPLOAD_MAX_BYTES }
});

/** multer.single wrapper with clear errors */
function uploadSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Максимальный размер файла — 30 МБ' });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({ error: 'Неверное поле файла (ожидается «file»)' });
        }
        return res.status(400).json({ error: 'Multer: ' + (err.message || err.code) });
      }
      if (err) {
        const msg = err.code === 'ENOENT'
          ? 'Папка uploads не найдена на сервере'
          : (err.message || 'Ошибка записи файла на диск');
        return res.status(500).json({ error: msg });
      }
      next();
    });
  };
}

// ==================== AUTH API ====================

function publicUser(u) {
  if (!u) return null;
  const deadlinesOn = u.notif_deadlines !== 0;
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    avatar: u.avatar,
    notif_reminders: u.notif_reminders !== 0,
    notif_deadlines: deadlinesOn,
    notif_deadline_week: u.notif_deadline_week === undefined || u.notif_deadline_week === null
      ? deadlinesOn : u.notif_deadline_week !== 0,
    notif_deadline_day: u.notif_deadline_day === undefined || u.notif_deadline_day === null
      ? deadlinesOn : u.notif_deadline_day !== 0,
    notif_overdue: u.notif_overdue !== 0
  };
}

app.post('/api/login', async (req, res) => {
  const { username, password, remember } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  if (!isHashed(user.password)) {
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(password), user.id);
  }

  const token = generateToken();
  const days = remember ? 30 : 1;
  const ttlSec = days * 24 * 60 * 60;
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  try {
    await sessionStore.set(token, user, ttlSec);
  } catch (e) {
    console.error('session set', e);
    return res.status(500).json({ error: 'Не удалось создать сессию' });
  }

  res.json({
    token,
    user: publicUser(user),
    expires_at: expiresAt
  });
});

// ==================== USERS API ====================

app.get('/api/users', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT id, username, name, role, avatar, created_at FROM users ORDER BY id').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор может создавать пользователей' });
    const { username, password, name, role } = req.body;
    if (!username || !password || !name) return res.status(400).json({ error: 'Заполните логин, пароль и имя' });
    if (password.length < 4) return res.status(400).json({ error: 'Пароль минимум 4 символа' });
    const userRole = (role === 'admin' || role === 'manager') ? role : 'manager';
    const avatar = makeAvatar(name);
    const result = db.prepare('INSERT INTO users (username, password, name, role, avatar) VALUES (?, ?, ?, ?, ?)')
      .run(username.trim(), hashPassword(password), name.trim(), userRole, avatar);
    const user = db.prepare('SELECT id, username, name, role, avatar, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'Такой логин уже существует' });
    res.status(500).json({ error: err.message });
  }
});

/** Update own profile: name, username, notification prefs */
app.put('/api/users/me', requireAuth, (req, res) => {
  try {
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!me) return res.status(404).json({ error: 'Пользователь не найден' });
    const name = req.body.name != null ? String(req.body.name).trim() : me.name;
    let username = req.body.username != null ? String(req.body.username).trim() : me.username;
    if (!name) return res.status(400).json({ error: 'Введите имя' });
    if (!username) return res.status(400).json({ error: 'Введите логин' });
    const avatar = makeAvatar(name);
    const nr = req.body.notif_reminders === undefined ? me.notif_reminders : (req.body.notif_reminders ? 1 : 0);
    const nw = req.body.notif_deadline_week === undefined ? me.notif_deadline_week : (req.body.notif_deadline_week ? 1 : 0);
    const nday = req.body.notif_deadline_day === undefined ? me.notif_deadline_day : (req.body.notif_deadline_day ? 1 : 0);
    const no = req.body.notif_overdue === undefined ? me.notif_overdue : (req.body.notif_overdue ? 1 : 0);
    const nd = req.body.notif_deadlines === undefined
      ? ((nw || nday) ? 1 : 0)
      : (req.body.notif_deadlines ? 1 : 0);
    try {
      db.prepare(`
        UPDATE users SET name=?, username=?, avatar=?, notif_reminders=?, notif_deadlines=?,
          notif_deadline_week=?, notif_deadline_day=?, notif_overdue=?
        WHERE id=?
      `).run(name, username, avatar, nr, nd, nw, nday, no, me.id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'Такой логин уже существует' });
      throw err;
    }
    // Keep sessions in sync
    db.prepare('UPDATE sessions SET username=?, name=?, avatar=? WHERE user_id=?')
      .run(username, name, avatar, me.id);
    // Rename soft-links in notifications / reminders for_user
    if (name !== me.name) {
      try {
        db.prepare('UPDATE notifications SET user_name=? WHERE user_name=?').run(name, me.name);
        db.prepare("UPDATE reminders SET for_user=? WHERE for_user=?").run(name, me.name);
        db.prepare("UPDATE reminders SET created_by=? WHERE created_by=?").run(name, me.name);
      } catch (e) {}
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id);
    res.json(publicUser(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/me/password', requireAuth, (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) return res.status(400).json({ error: 'Заполните пароли' });
    if (String(new_password).length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!me || !verifyPassword(current_password, me.password)) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashPassword(new_password), me.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор может удалять пользователей' });
    const id = parseInt(req.params.id, 10);
    if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GOALS API ====================

function mapGoal(g) {
  if (!g) return null;
  let assignees = [];
  try { assignees = JSON.parse(g.assignees || '[]'); } catch (e) { assignees = []; }
  return { ...g, assignees, progress: g.progress || 0 };
}

app.get('/api/goals', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM goals ORDER BY date_end ASC, created_at DESC').all();
    res.json(rows.map(mapGoal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/goals/:id', requireAuth, (req, res) => {
  try {
    const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
    if (!goal) return res.status(404).json({ error: 'Цель не найдена' });
    res.json(mapGoal(goal));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/goals', requireAuth, (req, res) => {
  try {
    const { name, description, assignees, date_start, date_end, status, progress } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название цели' });
    const id = 'goal_' + Date.now();
    const list = Array.isArray(assignees) ? assignees : [];
    db.prepare(`INSERT INTO goals (id, name, description, assignees, date_start, date_end, status, progress, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, name.trim(), description || '', JSON.stringify(list),
      date_start || '', date_end || '', status || 'active', progress || 0, req.user.name
    );
    res.status(201).json(mapGoal(db.prepare('SELECT * FROM goals WHERE id = ?').get(id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/goals/:id', requireAuth, (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Цель не найдена' });
    const { name, description, assignees, date_start, date_end, status, progress } = req.body;
    const list = Array.isArray(assignees) ? assignees : JSON.parse(old.assignees || '[]');
    db.prepare(`UPDATE goals SET name=?, description=?, assignees=?, date_start=?, date_end=?, status=?, progress=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
      name !== undefined ? name : old.name,
      description !== undefined ? description : old.description,
      JSON.stringify(list),
      date_start !== undefined ? date_start : old.date_start,
      date_end !== undefined ? date_end : old.date_end,
      status !== undefined ? status : old.status,
      progress !== undefined ? progress : old.progress,
      req.params.id
    );
    res.json(mapGoal(db.prepare('SELECT * FROM goals WHERE id = ?').get(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/goals/:id', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM goals WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    await sessionStore.del(token);
  }
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(row) || req.user });
});

// ==================== PROJECTS API ====================

app.get('/api/projects', requireAuth, (req, res) => {
  try {
    const { hashtag } = req.query;
    let projects;
    if (hashtag) {
      projects = db.prepare('SELECT * FROM projects WHERE hashtags LIKE ? ORDER BY created_at DESC').all(`%${hashtag}%`);
    } else {
      projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    }
    // Get team members for each project from tasks
    const teamStmt = db.prepare("SELECT DISTINCT person FROM tasks WHERE project_id = ? AND person != ''");
    res.json(projects.map(p => ({
      ...p,
      urgent: !!p.urgent,
      hashtags: JSON.parse(p.hashtags || '[]'),
      team: teamStmt.all(p.id).map(r => r.person)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const team = db.prepare("SELECT DISTINCT person FROM tasks WHERE project_id = ? AND person != ''").all(req.params.id).map(r => r.person);
    res.json({ ...project, urgent: !!project.urgent, hashtags: JSON.parse(project.hashtags || '[]'), team });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects', requireAuth, (req, res) => {
  try {
    const { id, name, client, phone, amount, status, urgent, deadline, progress, pay_status, pay_method, discount, discount_val, adequacy, source, description, hashtags, payment_due_date, assignee } = req.body;
    const projectId = id || 'proj_' + Date.now();
    
    db.prepare(`INSERT INTO projects (id, name, client, phone, amount, status, urgent, deadline, progress, pay_status, pay_method, discount, discount_val, adequacy, source, description, hashtags, payment_due_date, assignee)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      projectId, name, client, phone || '', amount || 0, status || 'Новый', urgent ? 1 : 0, deadline, progress || 0,
      pay_status || 'unpaid', pay_method || 'По счёту', discount || 'no', discount_val || '',
      adequacy || 'good', source || 'Сайт', description || '', JSON.stringify(hashtags || []), payment_due_date || '', assignee || ''
    );
    
    // Create reminder if payment_due_date is set
    if (payment_due_date) {
      const remindDate = new Date(payment_due_date);
      remindDate.setDate(remindDate.getDate() - 3);
      const remindDateStr = remindDate.toISOString().split('T')[0];
      db.prepare('INSERT INTO reminders (project_id, type, message, remind_date) VALUES (?, ?, ?, ?)').run(
        projectId, 'payment', `Напоминание: оплата по проекту "${name}" через 3 дня (${payment_due_date})`, remindDateStr
      );
    }
    
    logActivity(projectId, null, req.user.name, 'create_project', `Создан проект: ${name}`);
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    res.status(201).json({ ...project, urgent: !!project.urgent, hashtags: JSON.parse(project.hashtags || '[]') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id', requireAuth, (req, res) => {
  try {
    const { name, client, phone, amount, status, urgent, deadline, progress, pay_status, pay_method, discount, discount_val, adequacy, source, description, hashtags, payment_due_date, assignee } = req.body;
    
    const old = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    
    db.prepare(`UPDATE projects SET name=?, client=?, phone=?, amount=?, status=?, urgent=?, deadline=?, progress=?, pay_status=?, pay_method=?, discount=?, discount_val=?, adequacy=?, source=?, description=?, hashtags=?, payment_due_date=?, assignee=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(
      name, client, phone || '', amount, status, urgent ? 1 : 0, deadline, progress,
      pay_status, pay_method, discount, discount_val, adequacy, source,
      description, JSON.stringify(hashtags || []), payment_due_date || '',
      assignee !== undefined ? assignee : (old ? old.assignee : ''), req.params.id
    );
    
    // Update reminder if payment_due_date changed
    if (payment_due_date && payment_due_date !== old.payment_due_date) {
      // Delete old reminders
      db.prepare("DELETE FROM reminders WHERE project_id = ? AND type = 'payment'").run(req.params.id);
      // Create new reminder
      const remindDate = new Date(payment_due_date);
      remindDate.setDate(remindDate.getDate() - 3);
      const remindDateStr = remindDate.toISOString().split('T')[0];
      db.prepare('INSERT INTO reminders (project_id, type, message, remind_date) VALUES (?, ?, ?, ?)').run(
        req.params.id, 'payment', `Напоминание: оплата по проекту "${name}" через 3 дня (${payment_due_date})`, remindDateStr
      );
    }
    
    if (old && old.status !== status) {
      logActivity(req.params.id, null, req.user.name, 'change_status', `${old.status} → ${status}`);
    }
    
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    res.json({ ...project, urgent: !!project.urgent, hashtags: JSON.parse(project.hashtags || '[]') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CLIENT PORTAL (share link) ====================

async function visitSeriesAsync(projectId, days = 30) {
  try {
    const ch = await clickhouse.visitSeries(projectId, days);
    if (ch && ch.length) return ch;
  } catch (e) {}
  return visitSeries(projectId, days);
}

function clientLinkPayload(project, req) {
  const visits = visitSeries(project.id, 30);
  return Object.assign(portal.payload(project, req), {
    visits,
    visitsTotal: visits.reduce((s, v) => s + v.count, 0)
  });
}

function publicProjectDto(project, extra = {}) {
  const tasks = db.prepare(`
    SELECT id, name, column_status, done, date, date_end, parent_id, is_epic, updated_at, created_at
    FROM tasks
    WHERE project_id = ? AND COALESCE(client_visible, 1) = 1
    ORDER BY done ASC, created_at ASC
  `).all(project.id);
  const total = tasks.length;
  const doneCount = tasks.filter(t => t.done).length;
  const progress = total > 0 ? Math.round((doneCount / total) * 100) : (project.progress || 0);
  const activity = db.prepare(`
    SELECT action, details, created_at FROM activity
    WHERE project_id = ? AND action IN ('complete_task','change_status','create_task','client_link','approval','comment')
    ORDER BY created_at DESC LIMIT 40
  `).all(project.id).map(a => ({
    action: a.action,
    details: a.details || '',
    created_at: a.created_at
  }));
  let documents = [];
  try {
    documents = db.prepare(`
      SELECT id, name, type, size, created_at FROM documents
      WHERE project_id = ? AND COALESCE(doc_category, 'client') = 'client'
      ORDER BY created_at DESC LIMIT 50
    `).all(project.id);
  } catch (e) {
    documents = [];
  }
  const comments = db.prepare(`
    SELECT id, task_id, author_kind, author_name, body, created_at
    FROM client_comments
    WHERE project_id = ? AND client_visible = 1
    ORDER BY created_at DESC LIMIT 80
  `).all(project.id);
  const approvals = db.prepare(`
    SELECT id, task_id, status, comment, actor, decided_at, created_at
    FROM approvals WHERE project_id = ?
    ORDER BY created_at DESC LIMIT 80
  `).all(project.id);
  const statsEnabled = project.client_stats_enabled === undefined || project.client_stats_enabled === null
    ? true
    : !!project.client_stats_enabled;
  const visits = extra.visits || (statsEnabled ? visitSeries(project.id, 30) : []);
  return {
    id: project.id,
    project: {
      id: project.id,
      name: project.name,
      client: project.client,
      status: project.status,
      deadline: project.deadline || '',
      progress,
      description: project.description || ''
    },
    tasks: tasks.map(t => ({
      id: t.id,
      name: t.name,
      status: t.column_status || (t.done ? 'Готово' : 'Ожидает'),
      done: !!t.done,
      date: t.date || '',
      date_end: t.date_end || '',
      parent_id: t.parent_id || null,
      is_epic: !!t.is_epic
    })),
    stats: { total, done: doneCount, progress },
    activity,
    documents,
    comments,
    approvals,
    stats_enabled: statsEnabled,
    site_url: project.client_site_url || '',
    visits,
    visitsTotal: visits.reduce((s, v) => s + v.count, 0)
  };
}

app.get('/api/projects/:id/client-link', requireAuth, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(clientLinkPayload(project, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/client-link', requireAuth, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const regen = !!(req.body && req.body.regenerate);
    portal.ensureLink(project.id, { regenerate: regen, createdBy: req.user.name });
    logActivity(project.id, null, req.user.name, 'client_link', regen ? 'Обновлена ссылка клиента' : 'Включён портал клиента');
    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
    res.json(clientLinkPayload(updated, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/projects/:id/client-link', requireAuth, (req, res) => {
  try {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const body = req.body || {};
    if (body.revoke) {
      portal.revokeLink(project.id);
      logActivity(project.id, null, req.user.name, 'client_link', 'Ссылка клиента отозвана');
    }
    const sets = [];
    const vals = [];
    if (Object.prototype.hasOwnProperty.call(body, 'enabled')) {
      const enabled = !!body.enabled;
      if (enabled) portal.ensureLink(project.id, { createdBy: req.user.name });
      else portal.revokeLink(project.id);
      sets.push('client_portal_enabled=?');
      vals.push(enabled ? 1 : 0);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'stats_enabled')) {
      sets.push('client_stats_enabled=?');
      vals.push(body.stats_enabled ? 1 : 0);
    }
    if (sets.length) {
      sets.push('updated_at=CURRENT_TIMESTAMP');
      vals.push(project.id);
      db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id=?`).run(...vals);
    }
    const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id);
    res.json(clientLinkPayload(updated, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function resolvePublicClient(req, res) {
  const token = String(req.params.token || '').trim();
  const link = portal.getLinkByToken(token);
  const check = portal.linkUsable(link);
  if (!check.ok) {
    res.status(404).json({ error: check.error });
    return null;
  }
  return check;
}

app.get('/api/public/client/:token', async (req, res) => {
  try {
    const resolved = resolvePublicClient(req, res);
    if (!resolved) return;
    const { project, link } = resolved;
    if (!link.is_preview) portal.touchLink(link);
    const statsEnabled = project.client_stats_enabled === undefined || project.client_stats_enabled === null
      ? true : !!project.client_stats_enabled;
    const visits = statsEnabled ? await visitSeriesAsync(project.id, 30) : [];
    const dto = publicProjectDto(project, { visits });
    let projects = [dto];
    if (project.client_id) {
      const siblings = db.prepare(`
        SELECT * FROM projects
        WHERE client_id = ? AND client_portal_enabled = 1
        ORDER BY updated_at DESC
      `).all(project.client_id);
      projects = siblings.map((p) => publicProjectDto(p, { visits: p.id === project.id ? visits : (p.client_stats_enabled === 0 ? [] : visitSeries(p.id, 30)) }));
    }
    res.json({
      preview: !!link.is_preview,
      scope: link.scope || 'view_and_edit_site',
      client_id: project.client_id || '',
      current_project_id: project.id,
      ...dto,
      projects
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeClientSiteUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.length > 500) throw new Error('Слишком длинный адрес');
  if (/^(javascript|data|vbscript):/i.test(s)) throw new Error('Недопустимый адрес');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try {
    u = new URL(s);
  } catch (e) {
    throw new Error('Введите корректный адрес сайта');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Только http/https');
  if (!u.hostname || !u.hostname.includes('.')) throw new Error('Введите адрес вида site.ru');
  return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')) + (u.search || '');
}

app.put(
  '/api/public/client/:token/site',
  rateLimit.middleware((req) => 'site:' + (req.params.token || '') + ':' + (req.ip || ''), { windowMs: 60000, max: 8 }),
  (req, res) => {
    try {
      const resolved = resolvePublicClient(req, res);
      if (!resolved) return;
      const { project, link } = resolved;
      if (link.is_preview) return res.status(403).json({ error: 'Превью нельзя менять сайт' });
      if (link.scope === 'view') return res.status(403).json({ error: 'Недостаточно прав' });
      const siteUrl = normalizeClientSiteUrl(req.body && req.body.site_url);
      db.prepare('UPDATE projects SET client_site_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
        .run(siteUrl, project.id);
      logActivity(project.id, null, 'Клиент', 'client_link', siteUrl ? 'Обновлён URL сайта' : 'Очищен URL сайта');
      res.json({ ok: true, site_url: siteUrl });
    } catch (err) {
      res.status(400).json({ error: err.message || 'Ошибка' });
    }
  }
);

app.post(
  '/api/public/client/:token/visit',
  rateLimit.middleware((req) => 'visit:' + (req.params.token || '') + ':' + (req.ip || ''), { windowMs: 60000, max: 12 }),
  async (req, res) => {
    try {
      const resolved = resolvePublicClient(req, res);
      if (!resolved) return;
      const { project, link } = resolved;
      if (link.is_preview) return res.json({ ok: true, recorded: false });
      const statsEnabled = project.client_stats_enabled === undefined || project.client_stats_enabled === null
        ? true : !!project.client_stats_enabled;
      if (!statsEnabled) return res.json({ ok: true, recorded: false });
      recordClientVisit(project.id);
      const event = {
        event_type: 'visit',
        project_id: project.id,
        link_id: link.id,
        occurred_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        ip_truncated: clickhouse.truncateIp(req.ip),
        user_agent: String(req.get('user-agent') || '').slice(0, 255)
      };
      const queued = await queue.enqueue('clickhouse-event', event);
      if (!queued) setImmediate(() => clickhouse.insertEvents([event]));
      res.json({ ok: true, recorded: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

app.post(
  '/api/public/client/:token/comments',
  rateLimit.middleware((req) => 'cmt:' + (req.params.token || '') + ':' + (req.ip || ''), { windowMs: 60000, max: 10 }),
  (req, res) => {
    try {
      const resolved = resolvePublicClient(req, res);
      if (!resolved) return;
      const { project, link } = resolved;
      if (link.is_preview) return res.status(403).json({ error: 'Превью только для просмотра' });
      const body = String((req.body && req.body.body) || '').trim();
      if (body.length < 2) return res.status(400).json({ error: 'Напишите комментарий' });
      if (body.length > 4000) return res.status(400).json({ error: 'Слишком длинный текст' });
      const id = crypto.randomBytes(12).toString('hex');
      db.prepare(`
        INSERT INTO client_comments (id, project_id, task_id, author_kind, author_name, body, client_visible)
        VALUES (?, ?, ?, 'client', ?, ?, 1)
      `).run(id, project.id, (req.body && req.body.task_id) || '', project.client || 'Клиент', body);
      logActivity(project.id, req.body && req.body.task_id || null, project.client || 'Клиент', 'comment', body.slice(0, 80));
      notifyAllUsers(project.client || 'Клиент', 'comment', 'Комментарий клиента: ' + body.slice(0, 80), project.id);
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.post(
  '/api/public/client/:token/approvals',
  rateLimit.middleware((req) => 'appr:' + (req.params.token || '') + ':' + (req.ip || ''), { windowMs: 60000, max: 10 }),
  (req, res) => {
    try {
      const resolved = resolvePublicClient(req, res);
      if (!resolved) return;
      const { project, link } = resolved;
      if (link.is_preview) return res.status(403).json({ error: 'Превью только для просмотра' });
      const status = (req.body && req.body.status) === 'rejected' ? 'rejected' : 'approved';
      const taskId = (req.body && req.body.task_id) || '';
      const comment = String((req.body && req.body.comment) || '').slice(0, 2000);
      const id = crypto.randomBytes(12).toString('hex');
      db.prepare(`
        INSERT INTO approvals (id, project_id, task_id, status, comment, actor, actor_kind, decided_at)
        VALUES (?, ?, ?, ?, ?, ?, 'client', CURRENT_TIMESTAMP)
      `).run(id, project.id, taskId, status, comment, project.client || 'Клиент');
      logActivity(project.id, taskId || null, project.client || 'Клиент', 'approval', status + (comment ? ': ' + comment.slice(0, 60) : ''));
      notifyAllUsers(project.client || 'Клиент', 'approval', 'Клиент ' + (status === 'approved' ? 'согласовал' : 'отклонил') + ' этап', project.id);
      res.json({ ok: true, id, status });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  try {
    const projectId = req.params.id;
    // Cascade delete: subtasks → tasks → documents → calls → activity → reminders
    db.prepare('DELETE FROM subtasks WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(projectId);
    db.prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM documents WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM calls WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM activity WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM reminders WHERE project_id = ?').run(projectId);
    try { db.prepare('DELETE FROM client_link_visits WHERE project_id = ?').run(projectId); } catch (e) {}
    try { db.prepare('DELETE FROM client_access_links WHERE project_id = ?').run(projectId); } catch (e) {}
    try { db.prepare('DELETE FROM client_comments WHERE project_id = ?').run(projectId); } catch (e) {}
    try { db.prepare('DELETE FROM approvals WHERE project_id = ?').run(projectId); } catch (e) {}
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all unique hashtags
app.get('/api/hashtags', requireAuth, (req, res) => {
  try {
    const projects = db.prepare('SELECT hashtags FROM projects').all();
    const allHashtags = new Set();
    projects.forEach(p => {
      const tags = JSON.parse(p.hashtags || '[]');
      tags.forEach(t => allHashtags.add(t));
    });
    res.json([...allHashtags].sort());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TASKS API ====================

app.get('/api/tasks', requireAuth, (req, res) => {
  try {
    const { project_id } = req.query;
    let tasks;
    if (project_id) {
      tasks = db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC').all(project_id);
    } else {
      tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
    }
    res.json(tasks.map(mapTaskRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function mapTaskRow(task) {
  if (!task) return null;
  return {
    ...task,
    done: !!task.done,
    urgent: !!task.urgent,
    is_epic: !!task.is_epic,
    client_visible: task.client_visible === undefined || task.client_visible === null ? true : !!task.client_visible,
    hashtags: JSON.parse(task.hashtags || '[]')
  };
}

app.post('/api/tasks', requireAuth, (req, res) => {
  try {
    const { id, project_id, name, column_status, person, date, date_end, time, done, urgent, hashtags, parent_id, priority, description, is_epic, client_visible } = req.body;
    const taskId = id || 'task_' + Date.now();
    
    // Validate parent_id
    if (parent_id) {
      if (parent_id === taskId) return res.status(400).json({ error: 'Задача не может быть подзадачей самой себя' });
      const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(parent_id);
      if (!parent) return res.status(400).json({ error: 'Родительская задача не найдена' });
      if ((parent.project_id || '') !== (project_id || '')) {
        return res.status(400).json({ error: 'Родительская задача должна быть из того же проекта' });
      }
    }
    
    const creator = (req.user && req.user.name) || '';
    // Nested tasks can never be Epic — only top-level parents
    const epicVal = parent_id ? 0 : (is_epic ? 1 : 0);
    const visibleVal = client_visible === false || client_visible === 0 ? 0 : 1;
    db.prepare(`INSERT INTO tasks (id, project_id, name, column_status, person, date, date_end, time, done, urgent, hashtags, parent_id, priority, description, is_epic, created_by, updated_by, client_visible)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      taskId, project_id || '', name, column_status || 'Ожидает', person || 'Костя',
      date || '', date_end || '', time || '', done ? 1 : 0, urgent ? 1 : 0, JSON.stringify(hashtags || []), parent_id || null, priority || 'medium', description || '', epicVal,
      creator, creator, visibleVal
    );
    
    // Auto-Epic only for top-level parent (not nested under another task)
    if (parent_id) {
      const parent = db.prepare('SELECT id, parent_id FROM tasks WHERE id = ?').get(parent_id);
      if (parent && !parent.parent_id) {
        db.prepare('UPDATE tasks SET is_epic=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(parent_id);
      }
    }

    if (project_id) updateProjectProgress(project_id);
    logActivity(project_id || '', taskId, req.user.name, 'create_task', `Создана задача: ${name}`);
    notifyUser(person || '', req.user.name, 'create_task', `${req.user.name} назначил вам задачу «${name}»`, taskId, project_id || null);
    
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    res.status(201).json(mapTaskRow(task));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    const { name, column_status, person, date, date_end, time, done, urgent, hashtags, parent_id, priority, description, is_epic, project_id, client_visible } = req.body;
    
    const old = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Задача не найдена' });
    
    const newProjectId = project_id !== undefined ? (project_id || '') : (old.project_id || '');

    // Validate parent_id if changing
    const newParentId = parent_id !== undefined ? (parent_id || null) : old.parent_id;
    if (newParentId) {
      if (newParentId === req.params.id) return res.status(400).json({ error: 'Задача не может быть подзадачей самой себя' });
      let checkId = newParentId;
      while (checkId) {
        if (checkId === req.params.id) return res.status(400).json({ error: 'Нельзя создать цикл вложенности' });
        const p = db.prepare('SELECT parent_id FROM tasks WHERE id = ?').get(checkId);
        checkId = p ? p.parent_id : null;
      }
      const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(newParentId);
      if (parent && (parent.project_id || '') !== (newProjectId || '')) {
        return res.status(400).json({ error: 'Родительская задача должна быть из того же проекта' });
      }
    }

    let epicFlag = is_epic !== undefined ? (is_epic ? 1 : 0) : (old.is_epic ? 1 : 0);
    // Nested tasks can never be Epic — strip flag when linked under a parent
    if (newParentId) epicFlag = 0;
    const visibleVal = client_visible !== undefined
      ? ((client_visible === false || client_visible === 0) ? 0 : 1)
      : (old.client_visible === 0 ? 0 : 1);
    
    const updater = (req.user && req.user.name) || '';
    db.prepare(`UPDATE tasks SET project_id=?, name=?, column_status=?, person=?, date=?, date_end=?, time=?, done=?, urgent=?, hashtags=?, parent_id=?, priority=?, description=?, is_epic=?, client_visible=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(
      newProjectId, name, column_status, person, date || '', date_end || '', time || '', done ? 1 : 0, urgent ? 1 : 0,
      JSON.stringify(hashtags || []), newParentId, priority || 'medium', description || '', epicFlag, visibleVal, updater, req.params.id
    );

    // Auto-Epic only for top-level parent (not nested)
    if (newParentId) {
      const parent = db.prepare('SELECT id, parent_id FROM tasks WHERE id = ?').get(newParentId);
      if (parent && !parent.parent_id) {
        db.prepare('UPDATE tasks SET is_epic=1, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(newParentId);
      }
    }
    
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (task) {
      if (task.project_id) updateProjectProgress(task.project_id);
      if (old && old.done !== (done ? 1 : 0)) {
        logActivity(task.project_id, req.params.id, req.user.name, done ? 'complete_task' : 'uncomplete_task', name);
      }
      
      // Notify assignees about changes made by someone else
      if (old) {
        const changes = [];
        if (old.name !== name) changes.push(`название: «${old.name}» → «${name}»`);
        if (old.column_status !== column_status) changes.push(`статус: ${old.column_status} → ${column_status}`);
        if (old.done !== (done ? 1 : 0)) changes.push(done ? 'выполнена' : 'возвращена в работу');
        if ((old.date || '') !== (date || '')) changes.push('изменена дата');
        if ((old.date_end || '') !== (date_end || '')) changes.push('изменён дедлайн');
        if ((old.description || '') !== (description || '')) changes.push('изменено описание');
        
        if (old.person !== person) {
          // Reassigned: notify both old and new assignee
          notifyUser(person, req.user.name, 'assign_task', `${req.user.name} назначил вам задачу «${name}»`, task.id, task.project_id || null);
          notifyUser(old.person, req.user.name, 'reassign_task', `${req.user.name} переназначил задачу «${old.name}» на ${person}`, task.id, task.project_id || null);
        } else if (changes.length > 0) {
          notifyUser(old.person, req.user.name, 'update_task', `${req.user.name} изменил задачу «${old.name}»: ${changes.join(', ')}`, task.id, task.project_id || null);
        }
      }
    }
    
    res.json(mapTaskRow(task));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (task) {
      updateProjectProgress(task.project_id);
      notifyUser(task.person, req.user.name, 'delete_task', `${req.user.name} удалил задачу «${task.name}»`, null, task.project_id || null);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function updateProjectProgress(projectId) {
  const stats = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) as done FROM tasks WHERE project_id = ?').get(projectId);
  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
  db.prepare('UPDATE projects SET progress = ? WHERE id = ?').run(progress, projectId);
}

function ensureClientToken(projectId) {
  const link = portal.ensureLink(projectId);
  return link && link.token;
}

function clientPortalUrl(token, req) {
  return portal.portalUrl(token, req);
}

function recordClientVisit(projectId) {
  const day = new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO client_link_visits (project_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT(project_id, day) DO UPDATE SET count = count + 1
  `).run(projectId, day);
}

function visitSeries(projectId, days = 30) {
  const rows = db.prepare(`
    SELECT day, count FROM client_link_visits
    WHERE project_id = ? AND day >= date('now', ?)
    ORDER BY day ASC
  `).all(projectId, `-${Math.max(1, days) - 1} days`);
  const map = new Map(rows.map(r => [r.day, r.count]));
  const out = [];
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, count: map.get(key) || 0 });
  }
  return out;
}

// ==================== KANBAN COLUMNS API ====================

app.get('/api/kanban-columns', requireAuth, (req, res) => {
  try {
    const columns = db.prepare('SELECT * FROM kanban_columns ORDER BY sort_order').all();
    res.json(columns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/kanban-columns', requireAuth, (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM kanban_columns').get();
    const sortOrder = (maxOrder.max || 0) + 1;
    const result = db.prepare('INSERT INTO kanban_columns (name, color, sort_order) VALUES (?, ?, ?)').run(name.trim(), color || 'blue', sortOrder);
    const column = db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(column);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Колонка с таким названием уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/kanban-columns/:id', requireAuth, (req, res) => {
  try {
    const { name, color, sort_order } = req.body;
    const existing = db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Колонка не найдена' });
    db.prepare('UPDATE kanban_columns SET name = ?, color = ?, sort_order = ? WHERE id = ?').run(
      name || existing.name, color || existing.color, sort_order !== undefined ? sort_order : existing.sort_order, req.params.id
    );
    const column = db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(req.params.id);
    res.json(column);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Колонка с таким названием уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/kanban-columns/:id', requireAuth, (req, res) => {
  try {
    const column = db.prepare('SELECT * FROM kanban_columns WHERE id = ?').get(req.params.id);
    if (!column) return res.status(404).json({ error: 'Колонка не найдена' });
    const projectsUsing = db.prepare('SELECT COUNT(*) as count FROM projects WHERE status = ?').get(column.name);
    if (projectsUsing.count > 0) return res.status(400).json({ error: `В колонке "${column.name}" ${projectsUsing.count} проектов. Сначала переместите их.` });
    db.prepare('DELETE FROM kanban_columns WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== TASK COLUMNS API ====================

app.get('/api/task-columns', requireAuth, (req, res) => {
  try {
    const columns = db.prepare('SELECT * FROM task_columns ORDER BY sort_order').all();
    res.json(columns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/task-columns', requireAuth, (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM task_columns').get();
    const sortOrder = (maxOrder.max || 0) + 1;
    const result = db.prepare('INSERT INTO task_columns (name, color, sort_order) VALUES (?, ?, ?)').run(name.trim(), color || 'blue', sortOrder);
    const column = db.prepare('SELECT * FROM task_columns WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(column);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Статус с таким названием уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/task-columns/:id', requireAuth, (req, res) => {
  try {
    const { name, color, sort_order } = req.body;
    const existing = db.prepare('SELECT * FROM task_columns WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Статус не найден' });
    db.prepare('UPDATE task_columns SET name = ?, color = ?, sort_order = ? WHERE id = ?').run(
      name || existing.name, color || existing.color, sort_order !== undefined ? sort_order : existing.sort_order, req.params.id
    );
    const column = db.prepare('SELECT * FROM task_columns WHERE id = ?').get(req.params.id);
    res.json(column);
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Статус с таким названием уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/task-columns/:id', requireAuth, (req, res) => {
  try {
    const column = db.prepare('SELECT * FROM task_columns WHERE id = ?').get(req.params.id);
    if (!column) return res.status(404).json({ error: 'Статус не найден' });
    const tasksUsing = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE column_status = ?').get(column.name);
    if (tasksUsing.count > 0) return res.status(400).json({ error: `Статус "${column.name}" используется ${tasksUsing.count} задачами. Сначала переместите их.` });
    db.prepare('DELETE FROM task_columns WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== CALENDAR STATUSES ====================
app.get('/api/calendar-statuses', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM calendar_statuses ORDER BY sort_order').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calendar-statuses', requireAuth, (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Название обязательно' });
    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM calendar_statuses').get();
    const sortOrder = (maxOrder.max ?? -1) + 1;
    const result = db.prepare('INSERT INTO calendar_statuses (name, color, sort_order) VALUES (?, ?, ?)').run(name.trim(), color || 'blue', sortOrder);
    res.status(201).json(db.prepare('SELECT * FROM calendar_statuses WHERE id = ?').get(result.lastInsertRowid));
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Статус уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/calendar-statuses/:id', requireAuth, (req, res) => {
  try {
    const { name, color, sort_order } = req.body;
    const existing = db.prepare('SELECT * FROM calendar_statuses WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Статус не найден' });
    db.prepare('UPDATE calendar_statuses SET name=?, color=?, sort_order=? WHERE id=?').run(
      name || existing.name, color || existing.color, sort_order !== undefined ? sort_order : existing.sort_order, req.params.id
    );
    res.json(db.prepare('SELECT * FROM calendar_statuses WHERE id = ?').get(req.params.id));
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Статус уже существует' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/calendar-statuses/:id', requireAuth, (req, res) => {
  try {
    const column = db.prepare('SELECT * FROM calendar_statuses WHERE id = ?').get(req.params.id);
    if (!column) return res.status(404).json({ error: 'Статус не найден' });
    db.prepare('DELETE FROM calendar_statuses WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SUBTASKS API (compat → tasks.parent_id) ====================

function taskAsSubtask(t) {
  return {
    id: t.id,
    task_id: t.parent_id,
    name: t.name,
    person: t.person || '',
    deadline: t.date_end || t.date || '',
    done: !!t.done,
    created_at: t.created_at
  };
}

app.get('/api/tasks/:taskId/subtasks', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM tasks WHERE parent_id = ? ORDER BY created_at ASC'
    ).all(req.params.taskId);
    res.json(rows.map(taskAsSubtask));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/subtasks', requireAuth, (req, res) => {
  try {
    const { task_id, name, person, deadline } = req.body;
    if (!task_id || !name) return res.status(400).json({ error: 'Нужны task_id и name' });
    const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
    if (!parent) return res.status(404).json({ error: 'Родительская задача не найдена' });
    const id = 'task_' + Date.now();
    const creator = (req.user && req.user.name) || '';
    db.prepare(`
      INSERT INTO tasks (id, project_id, name, column_status, person, date, date_end, time, done, urgent, hashtags, parent_id, priority, description, is_epic, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, '', ?, '', 0, 0, '[]', ?, '', '', 0, ?, ?)
    `).run(
      id,
      parent.project_id || '',
      String(name).trim(),
      parent.column_status || 'Ожидает',
      person || '',
      deadline || '',
      task_id,
      creator,
      creator
    );
    try {
      db.prepare('UPDATE tasks SET is_epic = 1 WHERE id = ? AND (parent_id IS NULL OR parent_id = "")').run(task_id);
    } catch (e) {}
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    res.status(201).json(taskAsSubtask(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/subtasks/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row || !row.parent_id) return res.status(404).json({ error: 'Подзадача не найдена' });
    const name = req.body.name != null ? req.body.name : row.name;
    const done = req.body.done !== undefined ? (req.body.done ? 1 : 0) : row.done;
    const person = req.body.person !== undefined ? (req.body.person || '') : (row.person || '');
    const deadline = req.body.deadline !== undefined ? (req.body.deadline || '') : (row.date_end || '');
    db.prepare('UPDATE tasks SET name=?, done=?, person=?, date_end=? WHERE id=?')
      .run(name, done, person, deadline, req.params.id);
    const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    res.json(taskAsSubtask(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/subtasks/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Подзадача не найдена' });
    db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== WIKI KINDS API ====================

app.get('/api/wiki-kinds', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM wiki_kinds ORDER BY sort_order ASC, label ASC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki-kinds', requireAuth, (req, res) => {
  try {
    const label = String(req.body.label || '').trim();
    if (!label) return res.status(400).json({ error: 'Укажите название типа' });
    let key = String(req.body.key || '').trim().toLowerCase()
      .replace(/[^a-z0-9а-яё_-]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!key) {
      key = 'kind_' + Date.now().toString(36);
    }
    // Ensure unique key
    let base = key;
    let i = 1;
    while (db.prepare('SELECT id FROM wiki_kinds WHERE key = ?').get(key)) {
      key = base + '_' + i++;
    }
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_kinds').get();
    const info = db.prepare('INSERT INTO wiki_kinds (key, label, is_system, sort_order) VALUES (?, ?, 0, ?)').run(
      key, label, (max?.m ?? -1) + 1
    );
    const row = db.prepare('SELECT * FROM wiki_kinds WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/wiki-kinds/:id', requireAuth, (req, res) => {
  try {
    const kind = db.prepare('SELECT * FROM wiki_kinds WHERE id = ?').get(req.params.id);
    if (!kind) return res.status(404).json({ error: 'Тип не найден' });
    const pages = db.prepare(
      'SELECT id, title, kind, parent_id FROM wiki_pages WHERE kind = ? ORDER BY title ASC LIMIT 100'
    ).all(kind.key);
    if (pages.length) {
      return res.status(409).json({
        error: 'Нельзя удалить тип — есть страницы с этим типом',
        pages,
        count: pages.length
      });
    }
    db.prepare('DELETE FROM wiki_kinds WHERE id = ?').run(kind.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generic file upload for rich-editor attachments
app.post('/api/uploads', requireAuth, uploadSingle('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    let originalname = req.file.originalname || 'file';
    try {
      // Fix mojibake from latin1 multipart filenames
      originalname = Buffer.from(originalname, 'latin1').toString('utf8');
    } catch (e) {}
    res.status(201).json({
      filename: req.file.filename,
      url: '/uploads/' + req.file.filename,
      originalname,
      mimetype: req.file.mimetype || '',
      size: req.file.size || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== WIKI PAGES API (Confluence-like) ====================

function getWikiDescendantIds(rootId) {
  const all = db.prepare('SELECT id, parent_id FROM wiki_pages').all();
  const children = new Map();
  all.forEach(p => {
    const key = p.parent_id == null ? 'root' : String(p.parent_id);
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(p.id);
  });
  const out = [];
  const stack = [Number(rootId)];
  while (stack.length) {
    const id = stack.pop();
    out.push(id);
    const kids = children.get(String(id)) || [];
    kids.forEach(k => stack.push(k));
  }
  return out;
}

function wouldCreateCycle(pageId, newParentId) {
  if (newParentId == null || newParentId === '' || newParentId === 'null') return false;
  const pid = Number(newParentId);
  if (pid === Number(pageId)) return true;
  const descendants = getWikiDescendantIds(pageId);
  return descendants.includes(pid);
}

app.get('/api/wiki-pages', requireAuth, (req, res) => {
  try {
    const { project_id, kind, file_type, q } = req.query;
    let rows = db.prepare(`
      SELECT w.*, p.name as project_name, p.client as project_client
      FROM wiki_pages w
      LEFT JOIN projects p ON w.project_id = p.id
      ORDER BY w.sort_order ASC, w.title ASC
    `).all();
    if (project_id) {
      if (project_id === 'none') rows = rows.filter(r => !r.project_id);
      else rows = rows.filter(r => String(r.project_id) === String(project_id));
    }
    if (kind) {
      const kinds = String(kind).split(',').map(s => s.trim()).filter(Boolean);
      if (kinds.length) rows = rows.filter(r => kinds.includes(r.kind));
    }
    if (file_type) {
      const types = String(file_type).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (types.length) rows = rows.filter(r => types.includes(String(r.file_type || '').toLowerCase()));
    }
    if (q) {
      const needle = String(q).toLowerCase();
      rows = rows.filter(r =>
        (r.title || '').toLowerCase().includes(needle) ||
        (r.content || '').toLowerCase().includes(needle)
      );
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki-pages/upload', requireAuth, uploadSingle('file'), (req, res) => {
  try {
    const { parent_id, title, kind, project_id, file_type, file_size } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const parent = parent_id === undefined || parent_id === '' || parent_id === null ? null : Number(parent_id);
    const max = db.prepare(
      parent == null
        ? 'SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_pages WHERE parent_id IS NULL'
        : 'SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_pages WHERE parent_id = ?'
    ).get(...(parent == null ? [] : [parent]));
    const order = (max?.m ?? -1) + 1;
    const user = req.user?.name || '';
    const t = (title || req.file.originalname || 'Файл').trim();
    const ext = path.extname(req.file.originalname || '').replace('.', '').toUpperCase();
    const info = db.prepare(`INSERT INTO wiki_pages
      (parent_id, title, content, kind, project_id, file_path, file_type, file_size, sort_order, created_by, updated_by)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      parent, t, kind || 'file', project_id || null,
      req.file.filename, file_type || ext || 'FILE', file_size || '', order, user, user
    );
    const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/wiki-pages/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT w.*, p.name as project_name, p.client as project_client
      FROM wiki_pages w
      LEFT JOIN projects p ON w.project_id = p.id
      WHERE w.id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Страница не найдена' });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wiki-pages', requireAuth, (req, res) => {
  try {
    const { parent_id, title, content, kind, project_id, file_type, file_size, file_path, sort_order } = req.body;
    const t = (title || '').trim() || 'Новая страница';
    const k = kind || 'page';
    const parent = parent_id === undefined || parent_id === '' || parent_id === null ? null : Number(parent_id);
    let order = sort_order;
    if (order === undefined || order === null) {
      const max = db.prepare(
        parent == null
          ? 'SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_pages WHERE parent_id IS NULL'
          : 'SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_pages WHERE parent_id = ?'
      ).get(...(parent == null ? [] : [parent]));
      order = (max?.m ?? -1) + 1;
    }
    const user = req.user?.name || '';
    const info = db.prepare(`INSERT INTO wiki_pages
      (parent_id, title, content, kind, project_id, file_path, file_type, file_size, sort_order, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      parent, t, content || '', k, project_id || null,
      file_path || '', file_type || '', file_size || '', order, user, user
    );
    const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/wiki-pages/:id', requireAuth, (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Страница не найдена' });
    const {
      title, content, kind, project_id, parent_id, sort_order,
      file_type, file_size, file_path
    } = req.body;

    let newParent = old.parent_id;
    if (parent_id !== undefined) {
      newParent = parent_id === '' || parent_id === null ? null : Number(parent_id);
      if (wouldCreateCycle(old.id, newParent)) {
        return res.status(400).json({ error: 'Нельзя переместить страницу в своего потомка' });
      }
    }

    const user = req.user?.name || '';
    db.prepare(`UPDATE wiki_pages SET
      title = ?, content = ?, kind = ?, project_id = ?, parent_id = ?,
      sort_order = ?, file_type = ?, file_size = ?, file_path = ?,
      updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
      title !== undefined ? String(title).trim() || old.title : old.title,
      content !== undefined ? content : old.content,
      kind !== undefined ? kind : old.kind,
      project_id !== undefined ? (project_id || null) : old.project_id,
      newParent,
      sort_order !== undefined ? sort_order : old.sort_order,
      file_type !== undefined ? file_type : old.file_type,
      file_size !== undefined ? file_size : old.file_size,
      file_path !== undefined ? file_path : old.file_path,
      user,
      old.id
    );
    const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(old.id);
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Atomic reorder: [{ id, parent_id, sort_order }, ...] */
app.post('/api/wiki-pages/reorder', requireAuth, (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: 'Пустой список' });

    const get = db.prepare('SELECT id, parent_id FROM wiki_pages WHERE id = ?');
    const upd = db.prepare(`UPDATE wiki_pages SET parent_id = ?, sort_order = ?,
      updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    const user = req.user?.name || '';

    const tx = db.transaction(() => {
      for (const it of items) {
        const id = Number(it.id);
        if (!Number.isFinite(id)) throw new Error('Некорректный id');
        const old = get.get(id);
        if (!old) throw new Error('Страница не найдена: ' + id);
        const parent = it.parent_id === undefined
          ? old.parent_id
          : (it.parent_id === '' || it.parent_id === null ? null : Number(it.parent_id));
        if (wouldCreateCycle(id, parent)) {
          throw new Error('Нельзя переместить страницу в своего потомка');
        }
        const order = it.sort_order !== undefined && it.sort_order !== null
          ? Number(it.sort_order) : 0;
        upd.run(parent, order, user, id);
      }
    });
    tx();
    res.json({ success: true, count: items.length });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Ошибка сортировки' });
  }
});

app.delete('/api/wiki-pages/:id', requireAuth, (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Страница не найдена' });
    const ids = getWikiDescendantIds(old.id);
    const del = db.prepare('DELETE FROM wiki_pages WHERE id = ?');
    const tx = db.transaction(() => { ids.forEach(id => del.run(id)); });
    tx();
    res.json({ success: true, deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DOCUMENTS API (compat → wiki_pages) ====================

function wikiAsDocument(w) {
  let doc_category = 'client';
  let template_category = 'Другое';
  if (w.kind === 'template') { doc_category = 'template'; template_category = 'Шаблон'; }
  if (w.kind === 'prompt') { doc_category = 'template'; template_category = 'Промпт'; }
  return {
    id: w.id,
    project_id: w.project_id,
    name: w.title,
    type: w.file_type || (w.kind === 'page' ? 'PAGE' : 'FILE'),
    size: w.file_size || '',
    file_path: w.file_path || '',
    doc_category,
    template_category,
    created_at: w.created_at,
    project_name: w.project_name,
    project_client: w.project_client
  };
}

app.get('/api/documents', requireAuth, (req, res) => {
  try {
    const { project_id, category } = req.query;
    let rows = db.prepare(`
      SELECT w.*, p.name as project_name, p.client as project_client
      FROM wiki_pages w
      LEFT JOIN projects p ON w.project_id = p.id
      ORDER BY w.created_at DESC
    `).all();
    if (project_id) {
      rows = rows.filter(r => String(r.project_id || '') === String(project_id));
    } else if (category === 'template') {
      rows = rows.filter(r => r.kind === 'template' || r.kind === 'prompt');
    } else if (category) {
      rows = rows.filter(r => r.kind !== 'template' && r.kind !== 'prompt' && r.project_id);
    }
    res.json(rows.map(wikiAsDocument));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents', requireAuth, (req, res) => {
  try {
    const { project_id, name, type, size, doc_category, template_category } = req.body;
    const category = doc_category || 'client';
    let kind = 'file';
    if (category === 'template') {
      const tc = String(template_category || '').toLowerCase();
      kind = (tc.includes('промпт') || tc.includes('prompt')) ? 'prompt' : 'template';
    }
    const projId = kind === 'template' || kind === 'prompt' ? null : (project_id || null);
    const user = req.user?.name || '';
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_pages WHERE parent_id IS NULL').get();
    const info = db.prepare(`INSERT INTO wiki_pages
      (parent_id, title, content, kind, project_id, file_path, file_type, file_size, sort_order, created_by, updated_by)
      VALUES (NULL, ?, '', ?, ?, '', ?, ?, ?, ?, ?)`).run(
      name || 'Без названия', kind, projId, type || '', size || '', (max?.m ?? -1) + 1, user, user
    );
    const row = db.prepare(`
      SELECT w.*, p.name as project_name, p.client as project_client
      FROM wiki_pages w LEFT JOIN projects p ON w.project_id = p.id WHERE w.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json(wikiAsDocument(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/documents/:id', requireAuth, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM wiki_pages WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Документ не найден' });
    db.prepare('DELETE FROM wiki_pages WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/documents/upload', requireAuth, uploadSingle('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const { project_id, name, type, size, doc_category, template_category } = req.body;
    const category = doc_category || 'client';
    let kind = 'file';
    if (category === 'template') {
      const tc = String(template_category || '').toLowerCase();
      kind = (tc.includes('промпт') || tc.includes('prompt')) ? 'prompt' : 'template';
    }
    const projId = kind === 'template' || kind === 'prompt' ? null : (project_id || null);
    const user = req.user?.name || '';
    const ext = path.extname(req.file.originalname || '').replace('.', '').toUpperCase();
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM wiki_pages WHERE parent_id IS NULL').get();
    const info = db.prepare(`INSERT INTO wiki_pages
      (parent_id, title, content, kind, project_id, file_path, file_type, file_size, sort_order, created_by, updated_by)
      VALUES (NULL, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      (name || req.file.originalname || 'Файл').trim(),
      kind, projId, req.file.filename, type || ext || 'FILE', size || '',
      (max?.m ?? -1) + 1, user, user
    );
    const row = db.prepare(`
      SELECT w.*, p.name as project_name, p.client as project_client
      FROM wiki_pages w LEFT JOIN projects p ON w.project_id = p.id WHERE w.id = ?
    `).get(info.lastInsertRowid);
    res.status(201).json(wikiAsDocument(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/uploads/:filename', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const session = db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const safe = path.basename(req.params.filename);
  res.sendFile(path.join(__dirname, 'uploads', safe));
});

// ==================== CALLS API ====================

app.get('/api/calls', requireAuth, (req, res) => {
  try {
    const { project_id } = req.query;
    let calls;
    if (project_id) {
      calls = db.prepare('SELECT * FROM calls WHERE project_id = ? ORDER BY created_at DESC').all(project_id);
    } else {
      calls = db.prepare('SELECT c.*, p.name as project_name, p.client as project_client FROM calls c JOIN projects p ON c.project_id = p.id ORDER BY c.created_at DESC').all();
    }
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/calls', requireAuth, (req, res) => {
  try {
    const { project_id, date, text } = req.body;
    db.prepare('INSERT INTO calls (project_id, date, text) VALUES (?, ?, ?)').run(project_id, date, text);
    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(db.prepare('SELECT last_insert_rowid() as id').get().id);
    res.status(201).json(call);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/calls/:id', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM calls WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ACTIVITY API ====================

app.get('/api/activity', requireAuth, (req, res) => {
  try {
    const { project_id, limit } = req.query;
    let activity;
    if (project_id) {
      activity = db.prepare('SELECT * FROM activity WHERE project_id = ? ORDER BY created_at DESC LIMIT ?').all(project_id, parseInt(limit) || 20);
    } else {
      activity = db.prepare('SELECT a.*, p.name as project_name, p.client as project_client FROM activity a LEFT JOIN projects p ON a.project_id = p.id ORDER BY a.created_at DESC LIMIT ?').all(parseInt(limit) || 50);
    }
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SALARIES API ====================

app.get('/api/salaries', requireAuth, (req, res) => {
  try {
    const { month, from, to } = req.query;
    let salaries;
    if (from && to) {
      salaries = db.prepare(`
        SELECT * FROM salaries
        WHERE COALESCE(NULLIF(pay_date,''), paid_date, substr(created_at,1,10), month || '-01') >= ?
          AND COALESCE(NULLIF(pay_date,''), paid_date, substr(created_at,1,10), month || '-01') <= ?
        ORDER BY COALESCE(NULLIF(pay_date,''), paid_date, created_at) DESC
      `).all(String(from).slice(0, 10), String(to).slice(0, 10));
    } else if (month) {
      salaries = db.prepare('SELECT * FROM salaries WHERE month = ? ORDER BY created_at DESC').all(month);
    } else {
      salaries = db.prepare('SELECT * FROM salaries ORDER BY created_at DESC').all();
    }
    res.json(salaries.map(s => ({ ...s, paid: !!s.paid })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salaries', requireAuth, (req, res) => {
  try {
    const { user_name, amount, note, pay_date, payment_method } = req.body;
    const today = todayLocalISO();
    const payDate = pay_date || today;
    const month = (req.body.month || String(payDate).slice(0, 7) || today.slice(0, 7));
    const method = payment_method === 'cash' ? 'cash' : 'transfer';
    db.prepare('INSERT INTO salaries (user_name, amount, month, note, pay_date, payment_method) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user_name, amount, month, note || '', payDate, method);
    const salary = db.prepare('SELECT * FROM salaries WHERE id = ?').get(db.prepare('SELECT last_insert_rowid() as id').get().id);
    logActivity(null, null, req.user.name, 'add_salary', `Зарплата: ${user_name} - ${amount}₽ (${month})`);
    res.status(201).json({ ...salary, paid: !!salary.paid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/salaries/:id', requireAuth, (req, res) => {
  try {
    const { user_name, amount, month, paid, note, pay_date, payment_method } = req.body;
    const old = db.prepare('SELECT * FROM salaries WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Не найдено' });
    const paidDate = paid ? (old.paid_date || todayLocalISO()) : null;
    const method = payment_method === undefined
      ? (old.payment_method || 'transfer')
      : (payment_method === 'cash' ? 'cash' : 'transfer');
    const payDate = pay_date !== undefined ? (pay_date || '') : (old.pay_date || '');
    db.prepare('UPDATE salaries SET user_name=?, amount=?, month=?, paid=?, paid_date=?, note=?, pay_date=?, payment_method=? WHERE id=?')
      .run(
        user_name !== undefined ? user_name : old.user_name,
        amount !== undefined ? amount : old.amount,
        month !== undefined ? month : old.month,
        paid ? 1 : 0,
        paidDate,
        note !== undefined ? (note || '') : (old.note || ''),
        payDate,
        method,
        req.params.id
      );
    const salary = db.prepare('SELECT * FROM salaries WHERE id = ?').get(req.params.id);
    res.json({ ...salary, paid: !!salary.paid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/salaries/:id', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM salaries WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== EXPENSES API ====================

app.get('/api/expenses', requireAuth, (req, res) => {
  try {
    syncExpenseReminders();
    const { category, month, from, to } = req.query;
    let expenses;
    if (from && to) {
      expenses = db.prepare(
        'SELECT * FROM expenses WHERE date >= ? AND date <= ? ORDER BY date DESC, created_at DESC'
      ).all(String(from).slice(0, 10), String(to).slice(0, 10));
    } else if (category) {
      expenses = db.prepare('SELECT * FROM expenses WHERE category = ? ORDER BY date DESC, created_at DESC').all(category);
    } else if (month) {
      expenses = db.prepare("SELECT * FROM expenses WHERE strftime('%Y-%m', date) = ? ORDER BY date DESC, created_at DESC").all(month);
    } else {
      expenses = db.prepare('SELECT * FROM expenses ORDER BY date DESC, created_at DESC').all();
    }
    if (category && from && to) {
      expenses = expenses.filter(e => e.category === category);
    }
    res.json(expenses.map(e => ({
      ...e,
      is_recurring: !!e.is_recurring
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expenses', requireAuth, (req, res) => {
  try {
    const {
      category, description, amount, date, person, project_id, note,
      subcategory, explanation, is_recurring, recur_interval, next_date
    } = req.body;
    if (!category || amount == null || !date) {
      return res.status(400).json({ error: 'Категория, сумма и дата обязательны' });
    }
    if (category === 'Возврат' && !project_id) {
      return res.status(400).json({ error: 'Для возврата выберите проект' });
    }
    const desc = (description || '').trim() || category;
    const recurring = is_recurring ? 1 : 0;
    const interval = normalizeRecurInterval(recur_interval);
    let next = (next_date || '').slice(0, 10);
    if (recurring) {
      next = next || computeNextExpenseDate(date, interval);
    } else {
      next = '';
    }
    db.prepare(`INSERT INTO expenses
      (category, description, amount, date, person, project_id, note, subcategory, explanation, is_recurring, recur_interval, next_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      category, desc, amount, date, person || '', project_id || null, note || '',
      subcategory || '', explanation || '', recurring, interval, next
    );
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(db.prepare('SELECT last_insert_rowid() as id').get().id);
    if (recurring) syncExpenseReminders();
    logActivity(project_id || null, null, req.user.name, 'add_expense', `${category}: ${desc} - ${amount}₽`);
    res.status(201).json({ ...expense, is_recurring: !!expense.is_recurring });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/expenses/:id', requireAuth, (req, res) => {
  try {
    const old = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    if (!old) return res.status(404).json({ error: 'Не найдено' });
    const {
      category, description, amount, date, person, project_id, note,
      subcategory, explanation, is_recurring, recur_interval, next_date
    } = req.body;
    const cat = category !== undefined ? category : old.category;
    const proj = project_id !== undefined ? (project_id || null) : old.project_id;
    if (cat === 'Возврат' && !proj) {
      return res.status(400).json({ error: 'Для возврата выберите проект' });
    }
    const recurring = is_recurring !== undefined ? (is_recurring ? 1 : 0) : (old.is_recurring ? 1 : 0);
    const interval = recur_interval !== undefined
      ? normalizeRecurInterval(recur_interval)
      : normalizeRecurInterval(old.recur_interval || 'month');
    const baseDate = date !== undefined ? date : old.date;
    let next = next_date !== undefined ? (next_date || '') : (old.next_date || '');
    if (recurring) {
      next = next || computeNextExpenseDate(baseDate, interval);
    } else {
      next = '';
    }
    db.prepare(`UPDATE expenses SET
      category=?, description=?, amount=?, date=?, person=?, project_id=?, note=?,
      subcategory=?, explanation=?, is_recurring=?, recur_interval=?, next_date=?
      WHERE id=?`).run(
      cat,
      description !== undefined ? description : old.description,
      amount !== undefined ? amount : old.amount,
      baseDate,
      person !== undefined ? (person || '') : old.person,
      proj,
      note !== undefined ? (note || '') : old.note,
      subcategory !== undefined ? (subcategory || '') : (old.subcategory || ''),
      explanation !== undefined ? (explanation || '') : (old.explanation || ''),
      recurring,
      interval,
      next,
      req.params.id
    );
    syncExpenseReminders();
    const expense = db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
    res.json({ ...expense, is_recurring: !!expense.is_recurring });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expenses/:id', requireAuth, (req, res) => {
  try {
    db.prepare("DELETE FROM reminders WHERE expense_id = ? AND type = 'expense'").run(req.params.id);
    db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/expenses/stats', requireAuth, (req, res) => {
  try {
    const { month, from, to } = req.query;
    let stats;
    if (from && to) {
      stats = db.prepare(
        'SELECT category, SUM(amount) as total FROM expenses WHERE date >= ? AND date <= ? GROUP BY category ORDER BY total DESC'
      ).all(String(from).slice(0, 10), String(to).slice(0, 10));
    } else if (month) {
      stats = db.prepare("SELECT category, SUM(amount) as total FROM expenses WHERE strftime('%Y-%m', date) = ? GROUP BY category ORDER BY total DESC").all(month);
    } else {
      stats = db.prepare("SELECT category, SUM(amount) as total FROM expenses GROUP BY category ORDER BY total DESC").all();
    }
    const refundTotal = stats
      .filter(s => s.category === 'Возврат')
      .reduce((sum, s) => sum + (s.total || 0), 0);
    const total = stats
      .filter(s => s.category !== 'Возврат')
      .reduce((sum, s) => sum + (s.total || 0), 0);
    res.json({ categories: stats, total, refund_total: refundTotal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Expense categories (money settings)
app.get('/api/expense-categories', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM expense_categories ORDER BY sort_order ASC, name ASC').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/expense-categories', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите название' });
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM expense_categories').get();
    const info = db.prepare(
      'INSERT INTO expense_categories (name, sort_order, is_system) VALUES (?, ?, 0)'
    ).run(name, (max?.m ?? -1) + 1);
    res.status(201).json(db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return res.status(400).json({ error: 'Такая категория уже есть' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/expense-categories/:id', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только администратор' });
    const row = db.prepare('SELECT * FROM expense_categories WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    if (row.is_system) return res.status(400).json({ error: 'Системную категорию нельзя удалить' });
    db.prepare('DELETE FROM expense_categories WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== REMINDERS API ====================

app.get('/api/reminders', requireAuth, (req, res) => {
  try {
    syncExpenseReminders();
    fireDueExpenseReminderNotifications();
    fireDeadlineNotifications();
    const { active, date } = req.query;
    const me = req.user.name || '';
    // Note reminders: for me, or legacy without for_user
    const noteForMe = `(r.type != 'note' OR r.for_user IS NULL OR r.for_user = '' OR r.for_user = ?)`;
    let reminders;
    if (date) {
      const day = String(date).slice(0, 10);
      // Exact date, plus legacy undated notes on "today"
      const todayLocal = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      })();
      reminders = db.prepare(`
        SELECT r.*,
          p.name as project_name, p.client as project_client, p.amount as project_amount, p.payment_due_date,
          e.description as expense_description, e.amount as expense_amount, e.category as expense_category,
          e.next_date as expense_next_date, e.subcategory as expense_subcategory
        FROM reminders r
        LEFT JOIN projects p ON r.project_id IS NOT NULL AND r.project_id != '' AND r.project_id = p.id
        LEFT JOIN expenses e ON r.expense_id = e.id
        WHERE r.is_sent = 0 AND r.type = 'note'
          AND (
            r.remind_date = ?
            OR ((r.remind_date IS NULL OR r.remind_date = '') AND ? = ?)
          )
          AND (r.for_user IS NULL OR r.for_user = '' OR r.for_user = ?)
        ORDER BY r.created_at DESC
      `).all(day, day, todayLocal, me);
    } else if (active === 'true') {
      const today = todayLocalISO();
      reminders = db.prepare(`
        SELECT r.*,
          p.name as project_name, p.client as project_client, p.amount as project_amount, p.payment_due_date,
          e.description as expense_description, e.amount as expense_amount, e.category as expense_category,
          e.next_date as expense_next_date, e.subcategory as expense_subcategory
        FROM reminders r
        LEFT JOIN projects p ON r.project_id IS NOT NULL AND r.project_id != '' AND r.project_id = p.id
        LEFT JOIN expenses e ON r.expense_id = e.id
        WHERE r.is_sent = 0 AND (
          (r.type = 'note' AND (r.remind_date IS NULL OR r.remind_date = '' OR r.remind_date <= ?)
            AND (r.for_user IS NULL OR r.for_user = '' OR r.for_user = ?))
          OR (r.type != 'note' AND r.remind_date <= ? AND (r.type != 'payment' OR p.id IS NOT NULL))
        )
        ORDER BY CASE WHEN r.remind_date IS NULL OR r.remind_date = '' THEN 1 ELSE 0 END, r.remind_date ASC
      `).all(today, me, today);
    } else {
      reminders = db.prepare(`
        SELECT r.*,
          p.name as project_name, p.client as project_client, p.amount as project_amount, p.payment_due_date,
          e.description as expense_description, e.amount as expense_amount, e.category as expense_category,
          e.next_date as expense_next_date, e.subcategory as expense_subcategory
        FROM reminders r
        LEFT JOIN projects p ON r.project_id IS NOT NULL AND r.project_id != '' AND r.project_id = p.id
        LEFT JOIN expenses e ON r.expense_id = e.id
        WHERE ${noteForMe}
        ORDER BY r.remind_date DESC
      `).all(me);
    }
    res.json(reminders.map(r => ({ ...r, is_sent: !!r.is_sent, notified: !!r.notified })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reminders', requireAuth, (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message || !message.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()) {
      return res.status(400).json({ error: 'Введите текст напоминания' });
    }
    if (message.length > 50000) return res.status(400).json({ error: 'Текст слишком длинный' });
    let remind_date = req.body.remind_date;
    if (remind_date == null) remind_date = '';
    remind_date = String(remind_date).trim().slice(0, 10);
    if (remind_date && !/^\d{4}-\d{2}-\d{2}$/.test(remind_date)) {
      return res.status(400).json({ error: 'Некорректная дата' });
    }
    // Empty date → today, so it appears on calendar day page too
    if (!remind_date) {
      const d = new Date();
      remind_date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    let for_user = String(req.body.for_user || '').trim();
    if (!for_user) for_user = req.user.name || '';
    db.prepare(`
      INSERT INTO reminders (project_id, type, message, remind_date, expense_id, notified, is_sent, created_by, for_user)
      VALUES (NULL, 'note', ?, ?, NULL, 0, 0, ?, ?)
    `).run(message, remind_date, req.user.name || '', for_user);
    const id = db.prepare('SELECT last_insert_rowid() as id').get().id;
    const row = db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    res.status(201).json({ ...row, is_sent: !!row.is_sent, notified: !!row.notified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/reminders/:id/sent', requireAuth, (req, res) => {
  try {
    const rem = db.prepare('SELECT * FROM reminders WHERE id = ?').get(req.params.id);
    db.prepare('UPDATE reminders SET is_sent = 1 WHERE id = ?').run(req.params.id);
    // After dismissing a recurring expense reminder, roll next_date forward
    if (rem && rem.type === 'expense' && rem.expense_id) {
      const exp = db.prepare('SELECT * FROM expenses WHERE id = ?').get(rem.expense_id);
      if (exp && exp.is_recurring) {
        const next = computeNextExpenseDate(exp.next_date || exp.date, exp.recur_interval || 'month');
        db.prepare('UPDATE expenses SET next_date = ? WHERE id = ?').run(next, exp.id);
        syncExpenseReminders();
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/reminders/:id', requireAuth, (req, res) => {
  try {
    db.prepare('DELETE FROM reminders WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== NOTIFICATIONS API ====================

app.get('/api/notifications', requireAuth, (req, res) => {
  try {
    fireDeadlineNotifications();
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const offset = parseInt(req.query.offset) || 0;
    const archived = req.query.archived === '1' || req.query.archived === 'true' ? 1 : 0;
    const me = req.user.name || '';
    const items = db.prepare(`
      SELECT * FROM notifications
      WHERE user_name = ? AND IFNULL(is_archived, 0) = ?
      ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(me, archived, limit, offset);
    const unread = db.prepare(`
      SELECT COUNT(*) as c FROM notifications
      WHERE user_name = ? AND IFNULL(is_archived, 0) = 0 AND is_read = 0
    `).get(me).c;
    const total = db.prepare(`
      SELECT COUNT(*) as c FROM notifications
      WHERE user_name = ? AND IFNULL(is_archived, 0) = ?
    `).get(me, archived).c;
    const archiveTotal = db.prepare(`
      SELECT COUNT(*) as c FROM notifications
      WHERE user_name = ? AND IFNULL(is_archived, 0) = 1
    `).get(me).c;
    res.json({
      items: items.map(n => ({ ...n, is_read: !!n.is_read, is_archived: !!n.is_archived })),
      unread,
      total,
      archiveTotal,
      archived: !!archived
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/read-all', requireAuth, (req, res) => {
  try {
    db.prepare(`
      UPDATE notifications SET is_read = 1
      WHERE user_name = ? AND IFNULL(is_archived, 0) = 0
    `).run(req.user.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/notifications/:id/read', requireAuth, (req, res) => {
  try {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_name = ?').run(req.params.id, req.user.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Soft-delete → archive (current user only)
app.delete('/api/notifications/all', requireAuth, (req, res) => {
  try {
    db.prepare(`
      UPDATE notifications SET is_archived = 1, is_read = 1
      WHERE user_name = ? AND IFNULL(is_archived, 0) = 0
    `).run(req.user.name);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications/:id', requireAuth, (req, res) => {
  try {
    const r = db.prepare(`
      UPDATE notifications SET is_archived = 1, is_read = 1
      WHERE id = ? AND user_name = ?
    `).run(req.params.id, req.user.name);
    if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== GLOBAL SEARCH ====================

app.get('/api/search', requireAuth, (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ items: [] });
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const items = [];

    const projects = db.prepare(`
      SELECT id, name, client FROM projects
      WHERE name LIKE ? OR client LIKE ? OR IFNULL(description,'') LIKE ?
      ORDER BY updated_at DESC LIMIT 6
    `).all(like, like, like);
    projects.forEach(p => items.push({
      type: 'project',
      id: p.id,
      title: p.name,
      subtitle: p.client || '',
      href: '/pages/project.html?id=' + encodeURIComponent(p.id)
    }));

    const tasks = db.prepare(`
      SELECT id, name, person, project_id FROM tasks
      WHERE name LIKE ? OR IFNULL(description,'') LIKE ? OR IFNULL(person,'') LIKE ?
      ORDER BY updated_at DESC LIMIT 6
    `).all(like, like, like);
    tasks.forEach(t => items.push({
      type: 'task',
      id: t.id,
      title: t.name,
      subtitle: t.person || '',
      href: '/pages/task.html?id=' + encodeURIComponent(t.id)
    }));

    const goals = db.prepare(`
      SELECT id, name, status FROM goals
      WHERE name LIKE ? OR IFNULL(description,'') LIKE ?
      ORDER BY updated_at DESC LIMIT 4
    `).all(like, like);
    goals.forEach(g => items.push({
      type: 'goal',
      id: g.id,
      title: g.name,
      subtitle: g.status === 'done' ? 'Выполнена' : 'Активна',
      href: '/pages/goal.html?id=' + encodeURIComponent(g.id)
    }));

    const docs = db.prepare(`
      SELECT id, title, kind FROM wiki_pages
      WHERE title LIKE ? OR IFNULL(content,'') LIKE ?
      ORDER BY updated_at DESC LIMIT 4
    `).all(like, like);
    docs.forEach(d => items.push({
      type: 'document',
      id: String(d.id),
      title: d.title,
      subtitle: d.kind || 'page',
      href: '/pages/documents.html?page=' + encodeURIComponent(d.id)
    }));

    const me = req.user.name || '';
    const rems = db.prepare(`
      SELECT id, message, remind_date FROM reminders
      WHERE is_sent = 0 AND type = 'note'
        AND (for_user IS NULL OR for_user = '' OR for_user = ?)
        AND message LIKE ?
      ORDER BY created_at DESC LIMIT 3
    `).all(me, like);
    rems.forEach(r => {
      const day = (r.remind_date || '').slice(0, 10);
      items.push({
        type: 'reminder',
        id: String(r.id),
        title: String(r.message || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Напоминание',
        subtitle: day || 'Без даты',
        href: day
          ? '/pages/calendar-day.html?date=' + encodeURIComponent(day)
          : '/pages/dashboard.html'
      });
    });

    const expenses = db.prepare(`
      SELECT id, category, description, amount, date FROM expenses
      WHERE description LIKE ? OR category LIKE ? OR IFNULL(note,'') LIKE ?
      ORDER BY date DESC LIMIT 3
    `).all(like, like, like);
    expenses.forEach(e => items.push({
      type: 'expense',
      id: String(e.id),
      title: (e.category || '') + (e.description ? ' · ' + e.description : ''),
      subtitle: (e.amount != null ? e.amount + '₽' : '') + (e.date ? ' · ' + e.date : ''),
      href: '/pages/money.html'
    }));

    res.json({ items: items.slice(0, limit), q });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== INTEGRATIONS + DEPLOY ====================

function parseMeta(raw) {
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
}

function getIntegration(id) {
  return db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
}

function integrationPublic(r) {
  const meta = parseMeta(r.meta);
  let secret = {};
  try {
    const plain = vault.decrypt(r.secret_enc || '');
    if (plain) secret = JSON.parse(plain);
  } catch (e) { secret = {}; }
  const hasSecret = !!(r.secret_enc && String(r.secret_enc).length > 0);
  const safeSecret = {};
  if (r.type === 'github') {
    safeSecret.has_token = !!(secret.token);
    safeSecret.repoUrl = secret.repoUrl || meta.repoUrl || '';
    safeSecret.branch = secret.branch || meta.branch || 'main';
  } else if (r.type === 'ssh_deploy' || r.type === 'server_ssh') {
    safeSecret.has_password = !!(secret.password);
    safeSecret.host = secret.host || meta.host || '';
    safeSecret.port = secret.port || meta.port || 22;
    safeSecret.username = secret.username || meta.username || '';
    safeSecret.appDir = secret.appDir || meta.appDir || '/var/www/crm-app/server';
    safeSecret.backupDir = secret.backupDir || meta.backupDir || '/var/www/crm-app/backups';
    safeSecret.auto_connect = !!(meta.auto_connect);
  } else if (String(r.type || '').startsWith('ai_')) {
    safeSecret.has_api_key = !!(secret.api_key || secret.token);
  } else if (r.type === 'adminvps') {
    safeSecret.has_password = !!(secret.password);
    safeSecret.email = secret.email || meta.email || '';
    safeSecret.baseUrl = secret.baseUrl || meta.baseUrl || adminvpsOps.DEFAULT_BASE;
  }
  const configured = hasSecret
    || !!(safeSecret.repoUrl)
    || !!(safeSecret.host && safeSecret.username)
    || (r.type === 'adminvps' && !!(safeSecret.email && hasSecret))
    || (r.type === 'domain' && !!(meta.url || meta.domain || meta.renew_date))
    || (r.type === 'subscription' && !!(meta.renew_date || meta.paid_until || meta.plan || meta.amount))
    || (String(r.type || '').startsWith('ai_') && (meta.tariff || meta.renew_date || meta.tokens_used))
    || ['server', 'database'].includes(r.type);
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    status: r.status,
    last_check: r.last_check,
    last_error: r.last_error || '',
    meta,
    has_secret: hasSecret,
    configured,
    config: safeSecret,
    created_at: r.created_at,
    updated_at: r.updated_at
  };
}

function decryptSecretObj(row) {
  try {
    const plain = vault.decrypt(row.secret_enc || '');
    return plain ? JSON.parse(plain) : {};
  } catch (e) { return {}; }
}

function requireAdmin(req, res) {
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Только администратор' });
    return false;
  }
  return true;
}

function markIntegration(id, status, errMsg) {
  db.prepare(`
    UPDATE integrations SET status=?, last_check=CURRENT_TIMESTAMP, last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(status, errMsg || '', id);
}

function sshCfgFromIntegration(row) {
  const secret = decryptSecretObj(row);
  const meta = parseMeta(row.meta);
  const gh = db.prepare("SELECT * FROM integrations WHERE type = 'github' LIMIT 1").get();
  const ghSecret = gh ? decryptSecretObj(gh) : {};
  const ghMeta = gh ? parseMeta(gh.meta) : {};
  return {
    host: secret.host || meta.host,
    port: Number(secret.port || meta.port || 22),
    username: secret.username || meta.username,
    password: secret.password || '',
    appDir: secret.appDir || meta.appDir || '/var/www/crm-app/server',
    backupDir: secret.backupDir || meta.backupDir || '/var/www/crm-app/backups',
    repoUrl: ghSecret.repoUrl || ghMeta.repoUrl || secret.repoUrl || 'https://github.com/AndrewF250/CRM.git',
    branch: ghSecret.branch || ghMeta.branch || 'main',
    githubToken: ghSecret.token || ''
  };
}

app.get('/api/integrations', requireAuth, (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM integrations ORDER BY id').all();
    res.json(rows.map(integrationPublic));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/integrations/health', requireAuth, (req, res) => {
  try {
    const dbOk = !!db.prepare('SELECT 1 as ok').get();
    const ints = db.prepare('SELECT id, type, name, status, meta FROM integrations').all();
    const byType = (t) => ints.find(i => i.type === t);
    const statusOf = (row) => (row && row.status) || 'idle';
    const metaOf = (row) => parseMeta(row && row.meta);
    const github = byType('github');
    const ssh = ints.find(i => i.type === 'ssh_deploy' || i.type === 'server_ssh');
    const adminvps = byType('adminvps');
    const domain = byType('domain');
    const hosting = byType('subscription');
    const ais = ints.filter(i => String(i.type || '').startsWith('ai_'));
    const aiOk = ais.filter(i => i.status === 'ok').length;
    const coreTypes = new Set(['github', 'ssh_deploy', 'server_ssh', 'adminvps', 'domain', 'subscription', 'server', 'database']);
    const tracked = ints.filter(i =>
      coreTypes.has(i.type) || String(i.type || '').startsWith('ai_')
    );
    const okIntegrations = tracked.filter(i => i.status === 'ok').length;
    const uptimeSec = Math.floor(process.uptime());
    const info = appVersion.getInfo();
    const domainMeta = metaOf(domain);
    const hostMeta = metaOf(hosting);
    const ghMeta = metaOf(github);
    const sshMeta = metaOf(ssh);
    const avMeta = metaOf(adminvps);
    // Prefer vault secrets for display labels (host/repo often stored there)
    let ghSecret = {};
    let sshSecret = {};
    try {
      if (github) {
        const full = db.prepare('SELECT * FROM integrations WHERE id = ?').get(github.id);
        ghSecret = decryptSecretObj(full);
      }
      if (ssh) {
        const full = db.prepare('SELECT * FROM integrations WHERE id = ?').get(ssh.id);
        sshSecret = decryptSecretObj(full);
      }
    } catch (e) {}
    const repoUrl = ghSecret.repoUrl || ghMeta.repoUrl || '';
    let githubLabel = 'GitHub';
    try {
      const m = String(repoUrl).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
      if (m) githubLabel = m[1] + '/' + m[2];
      else if (repoUrl) githubLabel = String(repoUrl).replace(/^https?:\/\//, '').slice(0, 28);
    } catch (e) {}
    const sshHost = sshSecret.host || sshMeta.host || 'SSH';
    res.json({
      ok: dbOk,
      version: info.version,
      timezone: getAppTimezone(),
      server: { uptimeSec, node: process.version, pid: process.pid },
      db: { ok: dbOk },
      integrations: {
        total: tracked.length,
        ok: okIntegrations,
        github: statusOf(github),
        githubLabel,
        githubRepo: repoUrl,
        ssh: statusOf(ssh),
        sshLabel: sshHost,
        sshHost,
        adminvps: statusOf(adminvps),
        adminvpsLabel: avMeta.label || 'AdminVPS',
        adminvpsZoneId: avMeta.zone_id || '',
        domain: statusOf(domain),
        hosting: statusOf(hosting),
        ai: { total: ais.length, ok: aiOk },
        domainUrl: domainMeta.url || domainMeta.domain || hostMeta.domain || avMeta.domain || 'http://crm-seo-123.xyz/',
        hostingNote: hostMeta.note || '',
        hostingProvider: hostMeta.provider || '',
        hostingPlan: hostMeta.plan || '',
        hostingAmount: hostMeta.amount || '',
        hostingCurrency: hostMeta.currency || 'RUB',
        hostingExpires: hostMeta.paid_until || hostMeta.expires_at || hostMeta.renew_date || '',
        domainExpires: domainMeta.expires_at || domainMeta.renew_date || '',
        domainRegistrar: domainMeta.registrar || ''
      },
      checkedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations', requireAuth, (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const name = String(req.body.name || '').trim() || 'Новая нейронка';
    let type = String(req.body.type || '').trim();
    if (!type) type = 'ai_custom_' + Date.now().toString(36);
    if (!type.startsWith('ai_')) type = 'ai_' + type.replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
    const meta = Object.assign({
      provider: 'custom',
      tokens_used: 0,
      tokens_limit: 0,
      purchase_date: '',
      renew_date: '',
      tariff: '',
      label: 'Расход токенов и дата тарифа'
    }, req.body.meta && typeof req.body.meta === 'object' ? req.body.meta : {});
    const info = db.prepare(
      "INSERT INTO integrations (type, name, status, meta) VALUES (?, ?, 'idle', ?)"
    ).run(type, name, JSON.stringify(meta));
    res.status(201).json(integrationPublic(getIntegration(info.lastInsertRowid)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/integrations/:id', requireAuth, (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    if (!String(row.type || '').startsWith('ai_')) {
      return res.status(400).json({ error: 'Удалять можно только AI-интеграции' });
    }
    if (row.type === 'ai_openai' || row.type === 'ai_claude') {
      return res.status(400).json({ error: 'Системные AI нельзя удалить — переименуйте' });
    }
    db.prepare('DELETE FROM integrations WHERE id = ?').run(row.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/integrations/:id', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    const name = req.body.name != null ? String(req.body.name).trim() : row.name;
    let meta = parseMeta(row.meta);
    if (req.body.meta && typeof req.body.meta === 'object') {
      meta = { ...meta, ...req.body.meta };
    }
    let secret = decryptSecretObj(row);
    if (req.body.secret && typeof req.body.secret === 'object') {
      const prev = { ...secret };
      secret = { ...prev, ...req.body.secret };
      // empty string / null = keep previous password/token
      Object.keys(req.body.secret).forEach(k => {
        if (req.body.secret[k] === '' || req.body.secret[k] === null) {
          if (prev[k] != null && prev[k] !== '') secret[k] = prev[k];
          else delete secret[k];
        }
      });
    }
    const enc = Object.keys(secret).length ? vault.encrypt(JSON.stringify(secret)) : (row.secret_enc || '');
    db.prepare(`
      UPDATE integrations SET name=?, meta=?, secret_enc=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(name, JSON.stringify(meta), enc, row.id);
    // домен / биллинг: статус OK если есть дата продления или URL/план
    if (row.type === 'domain') {
      const ok = !!(meta.url || meta.domain) && !!(meta.renew_date || meta.expires_at);
      markIntegration(row.id, ok ? 'ok' : (meta.url || meta.domain ? 'idle' : 'idle'), '');
    } else if (row.type === 'subscription') {
      const ok = !!(meta.renew_date || meta.paid_until || (meta.plan && meta.amount));
      markIntegration(row.id, ok ? 'ok' : 'idle', '');
    }
    res.json(integrationPublic(getIntegration(row.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/integrations/:id/adminvps-captcha', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || row.type !== 'adminvps') {
      return res.status(400).json({ ok: false, error: 'Только для AdminVPS' });
    }
    const s = decryptSecretObj(row);
    const meta = parseMeta(row.meta);
    const baseUrl = s.baseUrl || meta.baseUrl || adminvpsOps.DEFAULT_BASE;
    const result = await adminvpsOps.fetchCaptcha({ baseUrl });
    if (!result.ok) return res.status(502).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations/:id/test', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row) return res.status(404).json({ error: 'Не найдено' });
    if (row.type === 'github') {
      const s = decryptSecretObj(row);
      const meta = parseMeta(row.meta);
      const repo = s.repoUrl || meta.repoUrl || '';
      if (!repo) {
        markIntegration(row.id, 'error', 'Не указан URL репозитория');
        return res.status(400).json({ ok: false, error: 'Не указан URL репозитория' });
      }
      markIntegration(row.id, 'ok', '');
      return res.json({ ok: true, message: 'GitHub конфиг сохранён', repo, branch: s.branch || meta.branch || 'main', has_token: !!s.token });
    }
    if (row.type === 'ssh_deploy' || row.type === 'server_ssh') {
      const cfg = sshCfgFromIntegration(row);
      if (!cfg.host || !cfg.username || !cfg.password) {
        markIntegration(row.id, 'error', 'Нужны host, username, password');
        return res.status(400).json({ ok: false, error: 'Нужны host, username, password' });
      }
      const result = await deployOps.testConnection(cfg);
      markIntegration(row.id, result.ok ? 'ok' : 'error', result.ok ? '' : (result.err || 'SSH fail'));
      return res.json(result);
    }
    if (row.type === 'adminvps') {
      const s = decryptSecretObj(row);
      const meta = parseMeta(row.meta);
      const email = s.email || meta.email || '';
      const password = s.password || '';
      const baseUrl = s.baseUrl || meta.baseUrl || adminvpsOps.DEFAULT_BASE;
      const zoneId = meta.zone_id || '';
      const captchaCode = req.body && req.body.captchaCode != null ? String(req.body.captchaCode) : '';
      const captchaSessionId = req.body && req.body.captchaSessionId != null ? String(req.body.captchaSessionId) : '';
      if (!email || !password) {
        markIntegration(row.id, 'error', 'Нужны email и пароль AdminVPS');
        return res.status(400).json({ ok: false, error: 'Нужны email и пароль AdminVPS' });
      }
      const result = await adminvpsOps.checkDnsZone({
        baseUrl, email, password, zoneId, captchaCode, captchaSessionId,
        integrationId: row.id
      });
      const panel_url = `${String(baseUrl).replace(/\/$/, '')}/index.php?m=DNSManager2&mg-action=editZone&zone_id=${encodeURIComponent(zoneId || '')}`;
      if (result.ok) {
        markIntegration(row.id, 'ok', '');
        db.prepare('UPDATE integrations SET meta=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(JSON.stringify({
            ...meta,
            last_ok_at: new Date().toISOString(),
            panel_url,
            captcha_block: false,
            dns_records_count: Array.isArray(result.records) ? result.records.length : 0
          }), row.id);
      } else if (result.captcha) {
        markIntegration(row.id, 'idle', result.err || 'Требуется капча');
        db.prepare('UPDATE integrations SET meta=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(JSON.stringify({ ...meta, panel_url, captcha_block: true }), row.id);
      } else {
        markIntegration(row.id, 'error', result.err || 'AdminVPS fail');
      }
      return res.json({
        ok: !!result.ok,
        message: result.message || (result.ok ? 'OK' : result.err),
        captcha: !!result.captcha,
        needLogin: !!result.needLogin,
        zoneId,
        panel_url,
        records: result.records || [],
        source: result.source || '',
        rawHint: result.rawHint || '',
        analysis: result.analysis || null
      });
    }
    markIntegration(row.id, 'ok', '');
    res.json({ ok: true, message: 'OK' });
  } catch (err) {
    try { markIntegration(req.params.id, 'error', err.message); } catch (e) {}
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/integrations/:id/adminvps-zone', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || row.type !== 'adminvps') {
      return res.status(400).json({ ok: false, error: 'Только для AdminVPS' });
    }
    const meta = parseMeta(row.meta);
    const s = decryptSecretObj(row);
    const baseUrl = s.baseUrl || meta.baseUrl || adminvpsOps.DEFAULT_BASE;
    const zoneId = meta.zone_id || '';
    const force = String(req.query.refresh || '') === '1';
    const result = await adminvpsOps.getZoneWithSession(row.id, { baseUrl, zoneId, force });
    // не 401 — иначе api.js разлогинит из CRM
    if (result.needLogin) return res.status(409).json({ ok: false, needLogin: true, error: result.err || 'Нужен вход' });
    if (!result.ok) return res.status(502).json({ ok: false, error: result.err || 'Ошибка зоны' });
    res.json({
      ok: true,
      zoneId,
      records: result.records || [],
      cached: !!result.cached,
      source: result.source || '',
      rawHint: result.rawHint || ''
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations/:id/adminvps-zone/records', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || row.type !== 'adminvps') {
      return res.status(400).json({ ok: false, error: 'Только для AdminVPS' });
    }
    const meta = parseMeta(row.meta);
    const body = req.body || {};
    const result = await adminvpsOps.mutateRecord(row.id, {
      action: 'add',
      zoneId: meta.zone_id || '',
      record: {
        name: body.name,
        type: body.type,
        ttl: body.ttl,
        data: body.data != null ? body.data : body.content
      }
    });
    if (result.needLogin) return res.status(409).json({ ok: false, needLogin: true, error: result.err });
    if (!result.ok) return res.status(502).json({ ok: false, error: result.err || 'Не удалось добавить', detail: result.detail });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/integrations/:id/adminvps-zone/records/:line', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || row.type !== 'adminvps') {
      return res.status(400).json({ ok: false, error: 'Только для AdminVPS' });
    }
    const meta = parseMeta(row.meta);
    const body = req.body || {};
    const result = await adminvpsOps.mutateRecord(row.id, {
      action: 'edit',
      zoneId: meta.zone_id || '',
      record: {
        line: req.params.line,
        id: body.id != null ? body.id : req.params.line,
        name: body.name,
        type: body.type,
        ttl: body.ttl,
        data: body.data != null ? body.data : body.content
      }
    });
    if (result.needLogin) return res.status(409).json({ ok: false, needLogin: true, error: result.err });
    if (!result.ok) return res.status(502).json({ ok: false, error: result.err || 'Не удалось изменить', detail: result.detail });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/integrations/:id/adminvps-zone/records/:line', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || row.type !== 'adminvps') {
      return res.status(400).json({ ok: false, error: 'Только для AdminVPS' });
    }
    const meta = parseMeta(row.meta);
    const result = await adminvpsOps.mutateRecord(row.id, {
      action: 'remove',
      zoneId: meta.zone_id || '',
      record: { line: req.params.line, id: req.params.line }
    });
    if (result.needLogin) return res.status(409).json({ ok: false, needLogin: true, error: result.err });
    if (!result.ok) return res.status(502).json({ ok: false, error: result.err || 'Не удалось удалить', detail: result.detail });
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations/:id/backup', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || (row.type !== 'ssh_deploy' && row.type !== 'server_ssh')) {
      return res.status(400).json({ error: 'Только для SSH-сервера' });
    }
    const cfg = sshCfgFromIntegration(row);
    const result = await deployOps.backupRemoteDb(cfg);
    markIntegration(row.id, result.ok ? 'ok' : 'error', result.ok ? '' : (result.err || 'backup fail'));
    res.json(result);
  } catch (err) {
    try { markIntegration(req.params.id, 'error', err.message); } catch (e) {}
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations/:id/deploy', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || (row.type !== 'ssh_deploy' && row.type !== 'server_ssh')) {
      return res.status(400).json({ error: 'Только для SSH-сервера' });
    }
    const cfg = sshCfgFromIntegration(row);
    if (!cfg.host || !cfg.username || !cfg.password) {
      return res.status(400).json({ error: 'Сначала сохраните и проверьте SSH' });
    }
    const result = await deployOps.deployFromGithub(cfg);
    markIntegration(row.id, result.ok ? 'ok' : 'error', result.ok ? '' : (result.err || 'deploy fail'));
    res.json(result);
  } catch (err) {
    try { markIntegration(req.params.id, 'error', err.message); } catch (e) {}
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations/:id/restore-prev', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || (row.type !== 'ssh_deploy' && row.type !== 'server_ssh')) {
      return res.status(400).json({ error: 'Только для SSH-сервера' });
    }
    const result = await deployOps.restorePrevDb(sshCfgFromIntegration(row));
    markIntegration(row.id, result.ok ? 'ok' : 'error', result.ok ? '' : (result.err || 'restore fail'));
    res.json(result);
  } catch (err) {
    try { markIntegration(req.params.id, 'error', err.message); } catch (e) {}
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/integrations/:id/keep-old-db', requireAuth, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const row = getIntegration(req.params.id);
    if (!row || (row.type !== 'ssh_deploy' && row.type !== 'server_ssh')) {
      return res.status(400).json({ error: 'Только для SSH-сервера' });
    }
    const result = await deployOps.keepOnlyOldDb(sshCfgFromIntegration(row));
    markIntegration(row.id, result.ok ? 'ok' : 'error', result.ok ? '' : (result.err || 'keep-old fail'));
    res.json(result);
  } catch (err) {
    try { markIntegration(req.params.id, 'error', err.message); } catch (e) {}
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== VERSION (realtime polling) ====================

app.get('/api/version', requireAuth, (req, res) => {
  const info = appVersion.getInfo();
  res.json({ v: changeVersion, app: info.version, name: info.name });
});

app.get('/api/app-info', requireAuth, (req, res) => {
  const info = appVersion.getInfo();
  let changelogHead = '';
  try {
    const fs = require('fs');
    const candidates = [
      require('path').join(__dirname, 'CHANGELOG.md'),
      require('path').join(__dirname, '..', 'CHANGELOG.md')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        changelogHead = fs.readFileSync(p, 'utf8').split('\n').slice(0, 40).join('\n');
        break;
      }
    }
  } catch (e) {}
  res.json({
    ...info,
    poll: changeVersion,
    changelogHead,
    timezone: getAppTimezone(),
    timezoneLabel: tzUtil.TZ_LABELS[getAppTimezone()] || getAppTimezone(),
    today: todayLocalISO(),
    now: tzUtil.nowTimeISO(getAppTimezone()),
    timezones: tzUtil.listTimezones()
  });
});

// ==================== APP SETTINGS (timezone) ====================

app.get('/api/app-settings', requireAuth, (req, res) => {
  try {
    const timezone = getAppTimezone();
    res.json({
      timezone,
      timezoneLabel: tzUtil.TZ_LABELS[timezone] || timezone,
      today: tzUtil.todayISO(timezone),
      now: tzUtil.nowTimeISO(timezone),
      timezones: tzUtil.listTimezones(),
      serverUtcNow: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/app-settings', requireAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Только администратор может менять часовой пояс' });
    }
    const oldTz = getAppTimezone();
    const nextTz = tzUtil.normalizeTz(req.body.timezone);
    const migrate = req.body.migrate !== false;
    let migration = { delta: 0, updated: 0 };
    if (nextTz !== oldTz) {
      setAppTimezone(nextTz);
      if (migrate) migration = migrateDatesForTimezone(oldTz, nextTz);
    }
    res.json({
      timezone: nextTz,
      timezoneLabel: tzUtil.TZ_LABELS[nextTz] || nextTz,
      today: tzUtil.todayISO(nextTz),
      now: tzUtil.nowTimeISO(nextTz),
      previousTimezone: oldTz,
      migration,
      timezones: tzUtil.listTimezones()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads', requireAuth, (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const rows = status
      ? db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY created_at DESC LIMIT 200').all(status)
      : db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 200').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/leads/:id', requireAuth, (req, res) => {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'Не найдено' });
    const status = String((req.body && req.body.status) || lead.status);
    db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, lead.id);
    res.json({ ...lead, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(
  '/api/leads',
  rateLimit.middleware((req) => 'lead:' + (req.ip || ''), { windowMs: 10 * 60 * 1000, max: 5 }),
  (req, res) => {
    try {
      const name = String((req.body && req.body.name) || '').trim();
      const contact = String((req.body && req.body.contact) || '').trim();
      const kind = String((req.body && req.body.kind) || '').trim();
      const task = String((req.body && req.body.task) || '').trim();
      const trap = String((req.body && req.body.website) || '').trim();
      if (trap) return res.json({ ok: true });
      if (!name || name.length > 120) return res.status(400).json({ error: 'Напишите, как к вам обращаться.', errors: { name: 'Напишите, как к вам обращаться.' } });
      if (!contact || contact.length > 190) return res.status(400).json({ error: 'Оставьте почту или ник в Telegram.', errors: { contact: 'Оставьте почту или ник в Telegram.' } });
      if (task.length < 10) return res.status(400).json({ error: 'Опишите задачу хотя бы одним предложением.', errors: { task: 'Опишите задачу хотя бы одним предложением.' } });
      const ip = String(req.ip || '').replace(/^::ffff:/, '');
      const recent = db.prepare(`
        SELECT COUNT(*) AS c FROM leads
        WHERE ip = ? AND created_at > datetime('now', '-10 minutes')
      `).get(ip);
      if (recent && recent.c >= 3) {
        return res.status(429).json({ error: 'Вы уже отправили несколько заявок. Подождите десять минут.' });
      }
      const id = crypto.randomBytes(12).toString('hex');
      db.prepare(`
        INSERT INTO leads (id, name, contact, kind, task, ip, ua, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
      `).run(id, name, contact, kind.slice(0, 60), task.slice(0, 5000), ip, String(req.get('user-agent') || '').slice(0, 255));
      notifyAllUsers('Сайт', 'lead', 'Заявка с сайта: ' + name + ' — ' + (kind || 'задача'), null);
      queue.enqueue('lead-notify', { id, name, contact, kind }).catch(() => {});
      res.json({ ok: true, id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.get('/api/clients', requireAuth, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS projects_count
      FROM clients c
      ORDER BY c.updated_at DESC
    `).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', requireAuth, (req, res) => {
  try {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!client) return res.status(404).json({ error: 'Не найдено' });
    const projects = db.prepare('SELECT id, name, status, deadline, progress FROM projects WHERE client_id = ?').all(client.id);
    const users = db.prepare('SELECT * FROM client_users WHERE client_id = ?').all(client.id);
    res.json({ ...client, projects, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', requireAuth, (req, res) => {
  try {
    const name = String((req.body && req.body.name) || '').trim();
    if (!name) return res.status(400).json({ error: 'Укажите имя клиента' });
    const id = crypto.randomBytes(12).toString('hex');
    db.prepare(`
      INSERT INTO clients (id, name, legal_name, inn, primary_email, primary_phone, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name,
      String((req.body && req.body.legal_name) || ''),
      String((req.body && req.body.inn) || ''),
      String((req.body && req.body.primary_email) || ''),
      String((req.body && req.body.primary_phone) || ''),
      String((req.body && req.body.notes) || '')
    );
    res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/comments', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM client_comments WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:id/comments', requireAuth, (req, res) => {
  try {
    const body = String((req.body && req.body.body) || '').trim();
    if (body.length < 2) return res.status(400).json({ error: 'Пустой комментарий' });
    const id = crypto.randomBytes(12).toString('hex');
    db.prepare(`
      INSERT INTO client_comments (id, project_id, task_id, author_kind, author_name, body, client_visible)
      VALUES (?, ?, ?, 'staff', ?, ?, ?)
    `).run(
      id,
      req.params.id,
      (req.body && req.body.task_id) || '',
      req.user.name,
      body,
      req.body && req.body.client_visible === false ? 0 : 1
    );
    logActivity(req.params.id, req.body && req.body.task_id || null, req.user.name, 'comment', body.slice(0, 80));
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/approvals', requireAuth, (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM approvals WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== STATS API ====================

app.get('/api/stats', requireAuth, (req, res) => {
  try {
    const projects = db.prepare('SELECT COUNT(*) as count FROM projects').get();
    const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status IN ('В работе', 'Переговоры', 'Новый', 'Абонемент')").get();
    const tasks = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE done = 0').get();
    const overdueTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE done = 0 AND urgent = 1").get();
    const pendingPayments = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM projects WHERE pay_status = 'unpaid' OR pay_status = 'pending'").get();
    const clients = db.prepare('SELECT COUNT(DISTINCT client) as count FROM projects').get();
    
    res.json({
      totalProjects: projects.count,
      activeProjects: activeProjects.count,
      pendingTasks: tasks.count,
      overdueTasks: overdueTasks.count,
      pendingPayments: pendingPayments.total,
      totalClients: clients.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(STAFF_WEB, 'index.html'));
});

// One-time: if data was created against UTC calendar "today", shift to app TZ (Perm)
try {
  const done = db.prepare("SELECT value FROM app_settings WHERE key = 'tz_utc_shift_done'").get();
  if (!done) {
    const appTz = getAppTimezone();
    const mig = migrateDatesForTimezone('UTC', appTz);
    db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ('tz_utc_shift_done', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(JSON.stringify({ from: 'UTC', to: appTz, ...mig }));
    if (mig.delta) console.log('Timezone date shift UTC →', appTz, mig);
  }
} catch (e) {
  console.error('tz_utc_shift_done:', e.message);
}

app.listen(PORT, '127.0.0.1', () => {
  console.log(`CRM Server running on http://127.0.0.1:${PORT} · TZ ${getAppTimezone()}`);
});
