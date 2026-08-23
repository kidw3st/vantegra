const db = require('../database');
const redis = require('./redis');

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.user_id,
    user_id: row.user_id,
    username: row.username,
    name: row.name,
    role: row.role,
    avatar: row.avatar,
    expires_at: row.expires_at
  };
}

async function get(token) {
  if (!token) return null;
  try {
    if (redis.enabled()) {
      const raw = await redis.get('sess:' + token);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    console.error('session redis get:', e.message);
  }
  const row = db.prepare(
    "SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(token);
  return rowToUser(row);
}

async function set(token, user, ttlSec) {
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`
    INSERT OR REPLACE INTO sessions (token, user_id, username, name, role, avatar, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(token, user.id || user.user_id, user.username, user.name, user.role, user.avatar || '', expiresAt);
  const payload = rowToUser({
    user_id: user.id || user.user_id,
    username: user.username,
    name: user.name,
    role: user.role,
    avatar: user.avatar || '',
    expires_at: expiresAt
  });
  try {
    if (redis.enabled()) await redis.setex('sess:' + token, ttlSec, JSON.stringify(payload));
  } catch (e) {
    console.error('session redis set:', e.message);
  }
  return payload;
}

async function del(token) {
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  } catch (e) {}
  try {
    if (redis.enabled()) await redis.del('sess:' + token);
  } catch (e) {}
}

module.exports = { get, set, del };