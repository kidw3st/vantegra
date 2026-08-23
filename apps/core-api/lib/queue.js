let workerReady = false;
let Queue = null;
let queue = null;

function enabled() {
  return !!(process.env.REDIS_URL && process.env.CLICKHOUSE_URL);
}

async function getQueue() {
  if (!enabled()) return null;
  if (queue) return queue;
  try {
    ({ Queue } = require('bullmq'));
    const Redis = require('ioredis');
    const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('vantegra', { connection });
    return queue;
  } catch (e) {
    console.error('queue init:', e.message);
    return null;
  }
}

async function enqueue(name, data, opts = {}) {
  const q = await getQueue();
  if (!q) return false;
  await q.add(name, data, Object.assign({ removeOnComplete: 200, removeOnFail: 50 }, opts));
  return true;
}

module.exports = { enabled, getQueue, enqueue, workerReady };