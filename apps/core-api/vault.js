/**
 * Server-side secret vault (AES-256-GCM).
 * Key: CRM_VAULT_KEY (64 hex chars = 32 bytes). Generated & stored in .vault-key if missing.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE = path.join(__dirname, '.vault-key');

function loadKey() {
  if (process.env.CRM_VAULT_KEY && /^[0-9a-fA-F]{64}$/.test(process.env.CRM_VAULT_KEY)) {
    return Buffer.from(process.env.CRM_VAULT_KEY, 'hex');
  }
  try {
    if (fs.existsSync(KEY_FILE)) {
      const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
      if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    }
  } catch (e) {}
  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  } catch (e) {
    console.error('vault: cannot write .vault-key', e.message);
  }
  return key;
}

const KEY = loadKey();

function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(blob) {
  if (!blob) return '';
  try {
    const buf = Buffer.from(String(blob), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return '';
  }
}

module.exports = { encrypt, decrypt };