/**
 * Sliding-window rate limiter. Redis when REDIS_URL is set, otherwise memory.
 */
const memory = new Map();

function prune(now) {
  for (const [key, hits] of memory) {
    const next = hits.filter((t) => now - t < 120000);
    if (next.length) memory.set(key, next);
    else memory.delete(key);
  }
}

async function hitRedis(key, windowMs, max) {
  const redis = require('./redis');
  if (!redis.enabled()) return null;
  const k = 'rl:' + key;
  const n = await redis.incr(k);
  if (n === 1) await redis.pexpire(k, windowMs);
  return n > max;
}

function hitMemory(key, windowMs, max) {
  const now = Date.now();
  if (memory.size > 4000) prune(now);
  const hits = (memory.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  memory.set(key, hits);
  return hits.length > max;
}

async function isLimited(key, { windowMs = 60000, max = 20 } = {}) {
  try {
    const redisHit = await hitRedis(key, windowMs, max);
    if (redisHit !== null) return redisHit;
  } catch (e) {
    console.error('rate-limit redis:', e.message);
  }
  return hitMemory(key, windowMs, max);
}

function middleware(makeKey, opts) {
  return async function rateLimitMw(req, res, next) {
    try {
      const key = typeof makeKey === 'function' ? makeKey(req) : makeKey;
      if (await isLimited(key, opts)) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
      }
      next();
    } catch (e) {
      next();
    }
  };
}

module.exports = { isLimited, middleware };