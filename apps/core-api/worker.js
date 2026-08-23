const db = require('./database');
const clickhouse = require('./lib/clickhouse');
const queue = require('./lib/queue');

async function handleJob(job) {
  const { name, data } = job;
  if (name === 'clickhouse-event' || (job.name === 'clickhouse-event')) {
    await clickhouse.insertEvents([data]);
    return;
  }
  if (name === 'lead-notify') {
    return;
  }
}

async function start() {
  if (!process.env.REDIS_URL || !process.env.CLICKHOUSE_URL) {
    console.log('worker: analytics queue off (no Redis/ClickHouse)');
    return;
  }
  const { Worker } = require('bullmq');
  const Redis = require('ioredis');
  const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker('vantegra', async (job) => {
    await handleJob(job);
  }, { connection });
  worker.on('failed', (job, err) => {
    console.error('worker failed', job && job.name, err.message);
  });
  console.log('worker: listening on queue vantegra');
}

if (require.main === module) {
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { start, handleJob };