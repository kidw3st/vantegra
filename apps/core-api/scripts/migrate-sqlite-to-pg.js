/**
 * Copy SQLite crm.db into Postgres. Run once during cutover.
 *   DATABASE_URL=... SQLITE_PATH=... node scripts/migrate-sqlite-to-pg.js
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const SQLITE_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', 'crm.db');
const DATABASE_URL = process.env.DATABASE_URL;
const SCHEMA = process.env.PG_SCHEMA
  || path.join(__dirname, '..', '..', '..', 'vantegra', 'infra', 'postgres', 'schema.sql');

const ORDER = [
  'users',
  'clients',
  'client_users',
  'projects',
  'tasks',
  'subtasks',
  'documents',
  'calls',
  'activity',
  'salaries',
  'expenses',
  'expense_categories',
  'reminders',
  'kanban_columns',
  'task_columns',
  'calendar_statuses',
  'notifications',
  'integrations',
  'goals',
  'wiki_kinds',
  'wiki_pages',
  'app_settings',
  'sessions',
  'client_access_links',
  'client_link_visits',
  'leads',
  'approvals',
  'client_comments'
];

function resolveSchema() {
  const candidates = [
    SCHEMA,
    '/opt/vantegra/infra/postgres/schema.sql',
    path.join(__dirname, '..', 'schema.sql')
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('schema.sql not found');
}

async function applySchema(client) {
  const sql = fs.readFileSync(resolveSchema(), 'utf8');
  await client.query(sql);
}

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('bad ident');
  return '"' + name + '"';
}

async function copyTable(sqlite, client, table) {
  const exists = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(table);
  if (!exists) {
    console.log('skip missing sqlite table', table);
    return 0;
  }
  const rows = sqlite.prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const colSql = cols.map(quoteIdent).join(', ');
  const placeholders = cols.map((_, i) => '$' + (i + 1)).join(', ');
  const insert = `INSERT INTO ${quoteIdent(table)} (${colSql}) VALUES (${placeholders})`;
  let n = 0;
  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    try {
      await client.query(insert, values);
      n++;
    } catch (err) {
      throw new Error(`${table} row failed: ${err.message}`);
    }
  }
  return n;
}

async function resetSequences(client) {
  const serials = [
    'users', 'documents', 'calls', 'activity', 'salaries', 'expenses',
    'expense_categories', 'reminders', 'kanban_columns', 'task_columns',
    'calendar_statuses', 'notifications', 'integrations', 'wiki_pages',
    'wiki_kinds', 'client_link_visits'
  ];
  for (const table of serials) {
    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('${table}', 'id'),
        COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 1),
        (SELECT COUNT(*) FROM ${quoteIdent(table)}) > 0
      )
    `);
  }
}

async function main() {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!fs.existsSync(SQLITE_PATH)) throw new Error('SQLite not found: ' + SQLITE_PATH);

  const sqlite = new Database(SQLITE_PATH, { readonly: true, fileMustExist: true });
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('schema', resolveSchema());

  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await applySchema(client);

  await client.query('BEGIN');
  try {
    for (const table of ORDER) {
      const n = await copyTable(sqlite, client, table);
      console.log(table, n);
    }
    await resetSequences(client);
    await client.query(
      `UPDATE integrations SET name = $1, status = 'ok', meta = $2, updated_at = NOW() WHERE type = 'database'`,
      ['PostgreSQL', JSON.stringify({ engine: 'postgres' })]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    sqlite.close();
    await client.end();
  }
  console.log('MIGRATE_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
