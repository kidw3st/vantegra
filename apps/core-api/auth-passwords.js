const bcrypt = require('bcryptjs');

function isHashed(p) {
  return typeof p === 'string' && /^\$2[aby]\$/.test(p);
}

function hashPassword(plain) {
  return bcrypt.hashSync(String(plain || ''), 10);
}

function verifyPassword(plain, stored) {
  if (stored == null || stored === '') return false;
  if (isHashed(stored)) {
    try { return bcrypt.compareSync(String(plain || ''), stored); } catch (e) { return false; }
  }
  return String(plain || '') === String(stored);
}

module.exports = { isHashed, hashPassword, verifyPassword };