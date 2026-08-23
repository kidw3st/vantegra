/**
 * Translate the SQLite dialect used in the CRM to Postgres.
 * Placeholders (?) become $1..$n after keyword rewrites.
 */
const SERIAL_TABLES = new Set([
  'activity',
  'calendar_statuses',
  'calls',
  'client_link_visits',
  'documents',
  'expense_categories',
  'expenses',
  'integrations',
  'kanban_columns',
  'notifications',
  'reminders',
  'salaries',
  'task_columns',
  'users',
  'wiki_kinds',
  'wiki_pages'
]);

function intervalNow(mod) {
  const raw = String(mod || '').trim();
  const neg = raw.startsWith('-');
  const body = raw.replace(/^[+-]\s*/, '').replace(/'/g, "''");
  if (!body) return 'NOW()';
  return neg ? `(NOW() - INTERVAL '${body}')` : `(NOW() + INTERVAL '${body}')`;
}

function tableOfInsert(sql) {
  const m = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/i);
  return m ? m[1] : '';
}

function sqliteToPg(sql) {
  let s = String(sql);

  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  s = s.replace(/\bdatetime\('now'\s*,\s*'([^']+)'\)/gi, (_, mod) => intervalNow(mod));
  s = s.replace(/\bdatetime\('now'\)/gi, 'NOW()');
  s = s.replace(/\bdate\('now'\s*,\s*\?\)/gi, '(CURRENT_DATE + (?::interval))');
  s = s.replace(/\bdate\('now'\)/gi, 'CURRENT_DATE');
  s = s.replace(/\bstrftime\('%Y-%m'\s*,\s*([^)]+)\)/gi, "to_char(($1)::timestamp, 'YYYY-MM')");
  s = s.replace(/\browid\b/gi, 'id');

  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+sessions\b/i.test(s)) {
    s = s.replace(/INSERT\s+OR\s+REPLACE\s+INTO\s+sessions/i, 'INSERT INTO sessions');
    if (!/ON CONFLICT/i.test(s)) {
      s = s.replace(/;?\s*$/, ' ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, username = EXCLUDED.username, name = EXCLUDED.name, role = EXCLUDED.role, avatar = EXCLUDED.avatar, expires_at = EXCLUDED.expires_at');
    }
  }

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(s)) {
    s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON CONFLICT/i.test(s)) {
      s = s.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
    }
  }

  s = s.replace(
    /ON CONFLICT\s*\(\s*project_id\s*,\s*day\s*\)\s*DO UPDATE SET count = count \+ 1/i,
    'ON CONFLICT (project_id, day) DO UPDATE SET count = client_link_visits.count + 1'
  );
  s = s.replace(/ON CONFLICT\s*\(/gi, 'ON CONFLICT (');

  s = s.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'SERIAL PRIMARY KEY');
  s = s.replace(/\bDATETIME\b/gi, 'TIMESTAMPTZ');

  let i = 0;
  s = s.replace(/\?/g, () => '$' + (++i));
  return s;
}

function shouldReturnId(originalSql) {
  const table = tableOfInsert(originalSql);
  if (!SERIAL_TABLES.has(table)) return false;
  if (/ON CONFLICT\s+DO\s+NOTHING/i.test(originalSql)) return false;
  if (/\bRETURNING\b/i.test(originalSql)) return false;
  return /^\s*INSERT/i.test(originalSql);
}

module.exports = { sqliteToPg, shouldReturnId, SERIAL_TABLES, tableOfInsert };
