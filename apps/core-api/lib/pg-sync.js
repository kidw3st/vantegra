/**
 * SQLite-shaped sync API over Postgres (single worker thread + one connection).
 * Express handlers stay synchronous, same as better-sqlite3.
 */
const { Worker } = require('worker_threads');
const path = require('path');

const HEADER = 16;
const CAP = 4 * 1024 * 1024;
const sab = new SharedArrayBuffer(HEADER + CAP);
const i32 = new Int32Array(sab, 0, 4);
const bytes = Buffer.from(sab);

let worker = null;
let lastInsertRowid = 0;

function call(msg, timeoutMs) {
  if (!worker) throw new Error('Postgres is not connected');
  Atomics.store(i32, 0, 0);
  worker.postMessage(msg);
  const status = Atomics.wait(i32, 0, 0, timeoutMs || 30000);
  if (status === 'timed-out') throw new Error('Postgres query timed out');
  const len = Atomics.load(i32, 1);
  const isErr = Atomics.load(i32, 2);
  const data = JSON.parse(bytes.slice(HEADER, HEADER + len).toString('utf8'));
  if (isErr) throw new Error(data.error || 'Postgres error');
  if (typeof data.lastInsertRowid !== 'undefined') lastInsertRowid = data.lastInsertRowid;
  return data;
}

function connect(url) {
  if (worker) return;
  worker = new Worker(path.join(__dirname, 'pg-sync-worker.js'), {
    workerData: { url, sab }
  });
  worker.on('error', (err) => console.error('pg-sync worker:', err.message));
  call({ type: 'connect' }, 20000);
}

function query(sql, params) {
  return call({ type: 'query', sql, params: params || [] });
}

function prepare(sql) {
  return {
    get(...params) {
      const r = query(sql, flatten(params));
      return r.rows[0] || undefined;
    },
    all(...params) {
      const r = query(sql, flatten(params));
      return r.rows;
    },
    run(...params) {
      const r = query(sql, flatten(params));
      return {
        changes: r.rowCount,
        lastInsertRowid: r.lastInsertRowid,
        lastID: r.lastInsertRowid
      };
    }
  };
}

function flatten(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function exec(sql) {
  const parts = String(sql)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) query(part, []);
}

function pragma() {
  return [];
}

function transaction(fn) {
  return function runTx(...args) {
    query('BEGIN', []);
    try {
      const out = fn.apply(this, args);
      query('COMMIT', []);
      return out;
    } catch (err) {
      try { query('ROLLBACK', []); } catch (e) {}
      throw err;
    }
  };
}

function close() {
  if (!worker) return;
  try { call({ type: 'close' }, 5000); } catch (e) {}
  worker.terminate();
  worker = null;
}

const db = {
  engine: 'postgres',
  prepare,
  exec,
  pragma,
  transaction,
  connect,
  close,
  get lastInsertRowid() { return lastInsertRowid; }
};

module.exports = db;
