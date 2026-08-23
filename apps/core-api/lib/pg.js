/**
 * Async PostgreSQL helpers for scripts (migrate, jobs).
 * The live Express app uses lib/pg-sync.js via database.js when DATABASE_URL is set.
 */
let pool = null;

function enabled() {
  return !!process.env.DATABASE_URL;
}

function getPool() {
  if (!enabled()) return null;
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000
  });
  pool.on('error', (err) => console.error('pg pool:', err.message));
  return pool;
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

async function query(sql, params = []) {
  const p = getPool();
  if (!p) throw new Error('DATABASE_URL is not set');
  return p.query(toPg(sql), params);
}

async function get(sql, params = []) {
  const r = await query(sql, params);
  return r.rows[0] || null;
}

async function all(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

async function run(sql, params = []) {
  const r = await query(sql, params);
  return { changes: r.rowCount, lastID: r.rows[0] && r.rows[0].id };
}

module.exports = { enabled, getPool, query, get, all, run, toPg };