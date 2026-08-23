let client = null;
let tried = false;

function enabled() {
  return !!process.env.REDIS_URL;
}

async function getClient() {
  if (!enabled()) return null;
  if (client) return client;
  if (tried) return client;
  tried = true;
  try {
    const Redis = require('ioredis');
    client = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    client.on('error', (err) => console.error('redis:', err.message));
    return client;
  } catch (e) {
    console.error('redis init:', e.message);
    client = null;
    return null;
  }
}

async function get(key) {
  const c = await getClient();
  if (!c) return null;
  return c.get(key);
}

async function setex(key, ttlSec, value) {
  const c = await getClient();
  if (!c) return false;
  await c.set(key, value, 'EX', ttlSec);
  return true;
}

async function del(key) {
  const c = await getClient();
  if (!c) return false;
  await c.del(key);
  return true;
}

async function incr(key) {
  const c = await getClient();
  if (!c) return null;
  return c.incr(key);
}

async function pexpire(key, ms) {
  const c = await getClient();
  if (!c) return false;
  await c.pexpire(key, ms);
  return true;
}

async function xadd(stream, payload) {
  const c = await getClient();
  if (!c) return null;
  return c.xadd(stream, '*', 'json', JSON.stringify(payload));
}

module.exports = {
  enabled,
  getClient,
  get,
  setex,
  del,
  incr,
  pexpire,
  xadd
};