const { parentPort, workerData } = require('worker_threads');
const { Client, types } = require('pg');
const { sqliteToPg, shouldReturnId } = require('./sql-dialect');

types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(1082, (v) => v);
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1184, (v) => v);

const HEADER = 16;
const sab = workerData.sab;
const i32 = new Int32Array(sab, 0, 4);
const bytes = Buffer.from(sab);
const CAP = sab.byteLength - HEADER;

let client = null;
let lastInsertRowid = 0;

function reply(payload, isErr) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  if (json.length > CAP) {
    const err = Buffer.from(JSON.stringify({ error: 'pg-sync result too large' }), 'utf8');
    err.copy(bytes, HEADER);
    Atomics.store(i32, 1, err.length);
    Atomics.store(i32, 2, 1);
    Atomics.store(i32, 0, 1);
    Atomics.notify(i32, 0);
    return;
  }
  json.copy(bytes, HEADER);
  Atomics.store(i32, 1, json.length);
  Atomics.store(i32, 2, isErr ? 1 : 0);
  Atomics.store(i32, 0, 1);
  Atomics.notify(i32, 0);
}

parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'connect') {
      client = new Client({ connectionString: workerData.url });
      await client.connect();
      reply({ ok: true });
      return;
    }
    if (msg.type === 'close') {
      if (client) await client.end();
      client = null;
      reply({ ok: true });
      return;
    }
    const sql = String(msg.sql || '');
    const params = msg.params || [];
    if (/last_insert_rowid\s*\(/i.test(sql)) {
      reply({ rows: [{ id: lastInsertRowid }], rowCount: 1, lastInsertRowid });
      return;
    }
    if (/^\s*PRAGMA\b/i.test(sql)) {
      reply({ rows: [], rowCount: 0, lastInsertRowid });
      return;
    }
    let pgSql = sqliteToPg(sql);
    if (shouldReturnId(sql)) {
      pgSql = pgSql.replace(/;?\s*$/, ' RETURNING id');
    }
    const result = await client.query(pgSql, params);
    const rows = result.rows || [];
    if (rows[0] && Object.prototype.hasOwnProperty.call(rows[0], 'id') && /^\s*INSERT/i.test(sql)) {
      lastInsertRowid = rows[0].id;
    }
    reply({
      rows,
      rowCount: result.rowCount || 0,
      lastInsertRowid
    });
  } catch (err) {
    reply({ error: err.message || String(err) }, true);
  }
});
