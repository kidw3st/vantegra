const Database = require('better-sqlite3');
const path = require('path');

if (process.env.DATABASE_URL) {
  const pgdb = require('./lib/pg-sync');
  pgdb.connect(process.env.DATABASE_URL);
  try {
    pgdb.prepare(
      "UPDATE integrations SET name = ?, status = 'ok', meta = ?, updated_at = CURRENT_TIMESTAMP WHERE type = 'database'"
    ).run('PostgreSQL', JSON.stringify({ engine: 'postgres' }));
  } catch (e) {
    console.error('pg integrations label:', e.message);
  }
  module.exports = pgdb;
  return;
}

const db = new Database(path.join(__dirname, 'crm.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    phone TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    status TEXT DEFAULT 'Новый',
    urgent INTEGER DEFAULT 0,
    deadline TEXT,
    progress INTEGER DEFAULT 0,
    pay_status TEXT DEFAULT 'unpaid',
    pay_method TEXT DEFAULT 'По счёту',
    discount TEXT DEFAULT 'no',
    discount_val TEXT DEFAULT '',
    adequacy TEXT DEFAULT 'good',
    source TEXT DEFAULT 'Сайт',
    description TEXT DEFAULT '',
    hashtags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT '',
    name TEXT NOT NULL,
    column_status TEXT DEFAULT 'Ожидает',
    person TEXT DEFAULT 'Костя',
    date TEXT,
    time TEXT,
    done INTEGER DEFAULT 0,
    urgent INTEGER DEFAULT 0,
    hashtags TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    name TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    person TEXT DEFAULT '',
    deadline TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size TEXT DEFAULT '',
    file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    task_id TEXT,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS salaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    amount REAL NOT NULL,
    month TEXT NOT NULL,
    paid INTEGER DEFAULT 0,
    paid_date TEXT,
    pay_date TEXT DEFAULT '',
    payment_method TEXT DEFAULT 'transfer',
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    person TEXT DEFAULT '',
    project_id TEXT,
    note TEXT DEFAULT '',
    subcategory TEXT DEFAULT '',
    explanation TEXT DEFAULT '',
    is_recurring INTEGER DEFAULT 0,
    recur_interval TEXT DEFAULT 'month',
    next_date TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: expense fields (AI subgroup, recurring, etc.)
['subcategory', 'explanation', 'recur_interval', 'next_date'].forEach(col => {
  try {
    db.prepare(`SELECT ${col} FROM expenses LIMIT 1`).get();
  } catch (e) {
    const def = col === 'recur_interval' ? "DEFAULT 'month'" : "DEFAULT ''";
    db.exec(`ALTER TABLE expenses ADD COLUMN ${col} TEXT ${def}`);
  }
});
try {
  db.prepare('SELECT is_recurring FROM expenses LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE expenses ADD COLUMN is_recurring INTEGER DEFAULT 0');
}

// Migration: add payment_due_date if not exists
try {
  db.prepare("SELECT payment_due_date FROM projects LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE projects ADD COLUMN payment_due_date TEXT DEFAULT ''");
}

// Migration: salaries pay_date + payment_method
try {
  db.prepare('SELECT pay_date FROM salaries LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE salaries ADD COLUMN pay_date TEXT DEFAULT ''");
}
try {
  db.prepare('SELECT payment_method FROM salaries LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE salaries ADD COLUMN payment_method TEXT DEFAULT 'transfer'");
}

// Editable expense categories (money settings)
db.exec(`
  CREATE TABLE IF NOT EXISTS expense_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    is_system INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
try {
  const catN = db.prepare('SELECT COUNT(*) as c FROM expense_categories').get().c;
  if (!catN) {
    const insCat = db.prepare('INSERT INTO expense_categories (name, sort_order, is_system) VALUES (?, ?, ?)');
    [
      ['Сервера', 0, 1],
      ['ИИ', 1, 1],
      ['Налоги', 2, 1],
      ['Возврат', 3, 1],
      ['Зарплата', 4, 1]
    ].forEach(([n, o, sys]) => insCat.run(n, o, sys));
  }
} catch (e) {}

// Create reminders table
db.exec(`
  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    type TEXT DEFAULT 'payment',
    message TEXT NOT NULL,
    remind_date TEXT NOT NULL,
    is_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

try {
  db.prepare('SELECT expense_id FROM reminders LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE reminders ADD COLUMN expense_id INTEGER');
}
try {
  db.prepare('SELECT notified FROM reminders LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE reminders ADD COLUMN notified INTEGER DEFAULT 0');
}
try {
  db.prepare('SELECT created_by FROM reminders LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE reminders ADD COLUMN created_by TEXT DEFAULT ''");
}
try {
  db.prepare('SELECT for_user FROM reminders LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE reminders ADD COLUMN for_user TEXT DEFAULT ''");
}

// Allow NULL project_id for note/expense reminders (FK was blocking '')
try {
  const remInfo = db.prepare('PRAGMA table_info(reminders)').all();
  const projCol = remInfo.find(c => c.name === 'project_id');
  if (projCol && projCol.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE reminders_mig (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT,
        type TEXT DEFAULT 'payment',
        message TEXT NOT NULL,
        remind_date TEXT NOT NULL DEFAULT '',
        is_sent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expense_id INTEGER,
        notified INTEGER DEFAULT 0,
        created_by TEXT DEFAULT '',
        for_user TEXT DEFAULT ''
      );
      INSERT INTO reminders_mig (id, project_id, type, message, remind_date, is_sent, created_at, expense_id, notified, created_by, for_user)
      SELECT id,
        CASE WHEN project_id IS NULL OR project_id = '' THEN NULL ELSE project_id END,
        type, message, COALESCE(remind_date, ''), is_sent, created_at, expense_id,
        COALESCE(notified, 0), COALESCE(created_by, ''),
        COALESCE(for_user, '')
      FROM reminders;
      DROP TABLE reminders;
      ALTER TABLE reminders_mig RENAME TO reminders;
    `);
    db.pragma('foreign_keys = ON');
  }
} catch (e) {
  console.error('reminders project_id migration failed:', e.message);
  try { db.pragma('foreign_keys = ON'); } catch (_) {}
}

// Migration: add doc_category if not exists
try {
  db.prepare("SELECT doc_category FROM documents LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE documents ADD COLUMN doc_category TEXT DEFAULT 'client'");
}

// Migration: add template_category if not exists
try {
  db.prepare("SELECT template_category FROM documents LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE documents ADD COLUMN template_category TEXT DEFAULT 'Другое'");
}

// Migration: add parent_id to tasks (for task nesting)
try {
  db.prepare("SELECT parent_id FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN parent_id TEXT DEFAULT NULL REFERENCES tasks(id) ON DELETE CASCADE");
}

// Migration: add date_end to tasks (date range)
try {
  db.prepare("SELECT date_end FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN date_end TEXT DEFAULT ''");
}

// Migration: add priority to tasks (low/medium/high)
try {
  db.prepare("SELECT priority FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'medium'");
}

// Migration: add description to tasks
try {
  db.prepare("SELECT description FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN description TEXT DEFAULT ''");
}

// Migration: allow empty project_id in tasks (remove NOT NULL + FOREIGN KEY)
try {
  const cols = db.prepare("PRAGMA table_info(tasks)").all();
  const pidCol = cols.find(c => c.name === 'project_id');
  if (pidCol && pidCol.notnull === 1) {
    const migrateTasks = db.transaction(() => {
      db.exec(`
        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY,
          project_id TEXT DEFAULT '',
          name TEXT NOT NULL,
          column_status TEXT DEFAULT 'Ожидает',
          person TEXT DEFAULT 'Костя',
          date TEXT,
          time TEXT,
          done INTEGER DEFAULT 0,
          urgent INTEGER DEFAULT 0,
          hashtags TEXT DEFAULT '[]',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          parent_id TEXT DEFAULT NULL,
          date_end TEXT DEFAULT '',
          priority TEXT DEFAULT 'medium',
          description TEXT DEFAULT ''
        );
        INSERT INTO tasks_new SELECT * FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `);
    });
    migrateTasks();
  }
} catch (e) {
  console.error('Tasks migration error:', e.message);
}

// Create kanban_columns table for configurable project columns
db.exec(`
  CREATE TABLE IF NOT EXISTS kanban_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'blue',
    sort_order INTEGER DEFAULT 0
  );
`);

// Create task_columns table for configurable task statuses
db.exec(`
  CREATE TABLE IF NOT EXISTS task_columns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'blue',
    sort_order INTEGER DEFAULT 0
  );
`);

// Per-user notifications about task changes
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    actor TEXT DEFAULT '',
    action TEXT DEFAULT '',
    message TEXT NOT NULL,
    task_id TEXT,
    project_id TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_name, is_read);
`);

try {
  db.prepare('SELECT is_archived FROM notifications LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE notifications ADD COLUMN is_archived INTEGER DEFAULT 0');
}
try {
  db.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_arch ON notifications(user_name, is_archived, id)');
} catch (e) {}

// Integrations registry (secrets stay server-side; no plaintext keys in meta)
db.exec(`
  CREATE TABLE IF NOT EXISTS integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'idle',
    last_check DATETIME,
    last_error TEXT DEFAULT '',
    meta TEXT DEFAULT '{}',
    secret_enc TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
try {
  const n = db.prepare('SELECT COUNT(*) as c FROM integrations').get().c;
  if (!n) {
    const ins = db.prepare(
      "INSERT INTO integrations (type, name, status, meta) VALUES (?, ?, ?, ?)"
    );
    ins.run('server', 'CRM App (local)', 'ok', JSON.stringify({ port: 3005, role: 'app' }));
    ins.run('database', 'SQLite crm.db', 'ok', JSON.stringify({ engine: 'sqlite' }));
    ins.run('subscription', 'Хостинг / домен', 'idle', JSON.stringify({ note: 'Подключите биллинг позже' }));
  }
  const ensure = (type, name, meta) => {
    const ex = db.prepare('SELECT id FROM integrations WHERE type = ? LIMIT 1').get(type);
    if (!ex) {
      db.prepare("INSERT INTO integrations (type, name, status, meta) VALUES (?, ?, 'idle', ?)")
        .run(type, name, JSON.stringify(meta));
    }
  };
  ensure('github', 'GitHub (деплой)', {
    repoUrl: 'https://github.com/AndrewF250/CRM.git',
    branch: 'main',
    label: 'Исходники для деплоя на сервер'
  });
  ensure('ssh_deploy', 'Сервер (SSH деплой)', {
    host: '78.17.100.31',
    port: 22,
    username: 'root',
    appDir: '/var/www/crm-app/server',
    backupDir: '/var/www/crm-app/backups',
    auto_connect: false,
    domain: 'https://crm-seo-123.xyz/',
    label: 'Прод-сервер: заливка кода и бэкап БД'
  });
  ensure('domain', 'Домен CRM', {
    url: 'https://crm-seo-123.xyz/',
    label: 'Публичный адрес CRM',
    renew_date: '',
    registrar: '',
    note: ''
  });
  ensure('subscription', 'Хостинг / домен (биллинг)', {
    domain: 'https://crm-seo-123.xyz/',
    label: 'Оплата хостинга / VPS',
    provider: 'AdminVPS',
    plan: '',
    amount: '',
    currency: 'RUB',
    renew_date: '',
    paid_until: '',
    note: ''
  });
  ensure('adminvps', 'AdminVPS (хостинг / DNS)', {
    baseUrl: 'https://my.adminvps.ru',
    zone_id: '64808',
    domain: 'https://crm-seo-123.xyz/',
    label: 'Кабинет AdminVPS · DNSManager',
    panel_url: 'https://my.adminvps.ru/index.php?m=DNSManager2&mg-action=editZone&zone_id=64808'
  });
  ensure('ai_openai', 'OpenAI / ChatGPT', {
    provider: 'openai',
    tokens_used: 0,
    tokens_limit: 0,
    purchase_date: '',
    renew_date: '',
    tariff: '',
    label: 'Расход токенов и дата тарифа'
  });
  ensure('ai_claude', 'Anthropic Claude', {
    provider: 'anthropic',
    tokens_used: 0,
    tokens_limit: 0,
    purchase_date: '',
    renew_date: '',
    tariff: '',
    label: 'Расход токенов и дата тарифа'
  });
  ensure('ai_other', 'Другая нейронка', {
    provider: 'other',
    tokens_used: 0,
    tokens_limit: 0,
    purchase_date: '',
    renew_date: '',
    tariff: '',
    label: 'Любой API: токены и тариф'
  });
  try {
    db.prepare("UPDATE integrations SET name = 'CRM App (этот сервер)', status = 'ok' WHERE type = 'server'").run();
    db.prepare("UPDATE integrations SET name = 'База данных SQLite', status = 'ok' WHERE type = 'database'").run();
    db.prepare("UPDATE integrations SET name = 'Хостинг / домен (биллинг)' WHERE type = 'subscription'").run();
    db.prepare("UPDATE integrations SET name = 'OpenAI / ChatGPT' WHERE type = 'ai_openai'").run();
    db.prepare("UPDATE integrations SET name = 'Anthropic Claude' WHERE type = 'ai_claude'").run();
    // не затираем meta subscription/domain — только имя
  } catch (e) {}
} catch (e) {}

// Migration: add assignee to projects
try {
  db.prepare("SELECT assignee FROM projects LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE projects ADD COLUMN assignee TEXT DEFAULT ''");
}

// Users table (login accounts)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'manager',
    avatar TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default users if table is empty
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const { hashPassword: hp } = require('./auth-passwords');
  const insertUser = db.prepare('INSERT INTO users (username, password, name, role, avatar) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('Костя', hp('kostya2026'), 'Костя', 'admin', 'КИ');
  insertUser.run('Максим', hp('maxim2026'), 'Максим', 'admin', 'МИ');
  insertUser.run('Андрей', hp('andrey2026'), 'Андрей', 'admin', 'АН');
}

// Per-user notification preferences
for (const col of [
  'notif_reminders',
  'notif_deadlines',
  'notif_deadline_week',
  'notif_deadline_day',
  'notif_overdue'
]) {
  try {
    db.prepare(`SELECT ${col} FROM users LIMIT 1`).get();
  } catch (e) {
    db.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER DEFAULT 1`);
  }
}

// Upgrade plaintext passwords → bcrypt
try {
  const { isHashed, hashPassword } = require('./auth-passwords');
  const plainUsers = db.prepare('SELECT id, password FROM users').all();
  const upd = db.prepare('UPDATE users SET password = ? WHERE id = ?');
  for (const u of plainUsers) {
    if (u.password && !isHashed(u.password)) {
      upd.run(hashPassword(u.password), u.id);
    }
  }
} catch (e) {
  console.error('password hash migration:', e.message);
}

// Migrate checklist subtasks → nested tasks (parent_id)
try {
  const subs = db.prepare('SELECT * FROM subtasks').all();
  if (subs.length) {
    const hasTask = db.prepare('SELECT id FROM tasks WHERE id = ?');
    const ins = db.prepare(`
      INSERT INTO tasks (id, project_id, name, column_status, person, date, date_end, time, done, urgent, hashtags, parent_id, priority, description, is_epic, created_by, updated_by)
      VALUES (?, ?, ?, 'Ожидает', ?, '', '', '', ?, 0, '[]', ?, '', '', 0, '', '')
    `);
    for (const s of subs) {
      const id = 'task_sub_' + s.id;
      if (hasTask.get(id)) continue;
      const parent = db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(s.task_id);
      ins.run(
        id,
        (parent && parent.project_id) || '',
        s.name || 'Подзадача',
        s.person || '',
        s.done ? 1 : 0,
        s.task_id
      );
    }
    db.prepare('DELETE FROM subtasks').run();
  }
} catch (e) {
  console.error('subtasks→parent_id migration:', e.message);
}

// Migration: epic flag for tasks (Agile-style parent stories)
try {
  db.prepare("SELECT is_epic FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN is_epic INTEGER DEFAULT 0");
}
// Epic only for top-level tasks — strip flag from nested ones
try {
  db.prepare("UPDATE tasks SET is_epic=0 WHERE parent_id IS NOT NULL AND parent_id != '' AND is_epic=1").run();
} catch (e) {}

// Migration: track who created / last updated a task
try {
  db.prepare("SELECT created_by FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN created_by TEXT DEFAULT ''");
}
try {
  db.prepare("SELECT updated_by FROM tasks LIMIT 1").get();
} catch (e) {
  db.exec("ALTER TABLE tasks ADD COLUMN updated_by TEXT DEFAULT ''");
}

// Goals (team objectives with multi-assignees and calendar dates)
db.exec(`
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    assignees TEXT DEFAULT '[]',
    date_start TEXT DEFAULT '',
    date_end TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    progress INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Calendar legend / status colors
db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'blue',
    sort_order INTEGER DEFAULT 0
  );
`);
const calStatusCount = db.prepare('SELECT COUNT(*) as c FROM calendar_statuses').get().c;
if (calStatusCount === 0) {
  const ins = db.prepare('INSERT INTO calendar_statuses (name, color, sort_order) VALUES (?, ?, ?)');
  [
    ['Просрочено', 'red', 0],
    ['В работе', 'green', 1],
    ['Ожидает', 'yellow', 2],
    ['Цель', 'purple', 3],
    ['Выполнено', 'gray', 4]
  ].forEach(([n, c, o]) => ins.run(n, c, o));
}

// Wiki pages (Confluence-like documents tree)
db.exec(`
  CREATE TABLE IF NOT EXISTS wiki_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER DEFAULT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    kind TEXT DEFAULT 'page',
    project_id TEXT DEFAULT NULL,
    file_path TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    file_size TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    updated_by TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Wiki page kinds / types (customizable)
db.exec(`
  CREATE TABLE IF NOT EXISTS wiki_kinds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    is_system INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
try {
  const kindCount = db.prepare('SELECT COUNT(*) as c FROM wiki_kinds').get().c;
  if (kindCount === 0) {
    const insKind = db.prepare('INSERT INTO wiki_kinds (key, label, is_system, sort_order) VALUES (?, ?, ?, ?)');
    [
      ['page', 'Страница', 1, 0],
      ['template', 'Шаблон', 1, 1],
      ['prompt', 'Промпт', 1, 2],
      ['file', 'Файл', 1, 3]
    ].forEach(([k, l, sys, o]) => insKind.run(k, l, sys, o));
  }
} catch (e) {}

// Migrate legacy documents → wiki_pages (Documents = single store)
try {
  const legacy = db.prepare('SELECT * FROM documents ORDER BY created_at ASC').all();
  const wikiHas = db.prepare(`
    SELECT id FROM wiki_pages
    WHERE title = ? AND IFNULL(project_id,'') = IFNULL(?, '')
      AND IFNULL(file_path,'') = IFNULL(?, '')
    LIMIT 1
  `);
  const ins = db.prepare(`INSERT INTO wiki_pages
    (parent_id, title, content, kind, project_id, file_path, file_type, file_size, sort_order, created_at, updated_at, created_by, updated_by)
    VALUES (NULL, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'migrate', 'migrate')`);
  let order = 1000;
  for (const d of legacy) {
    if (wikiHas.get(d.name || '', d.project_id || null, d.file_path || '')) continue;
    let kind = 'file';
    if (d.doc_category === 'template') {
      const tc = (d.template_category || '').toLowerCase();
      if (tc.includes('промпт') || tc.includes('prompt')) kind = 'prompt';
      else kind = 'template';
    }
    ins.run(
      d.name || 'Без названия',
      kind,
      d.project_id || null,
      d.file_path || '',
      d.type || '',
      d.size || '',
      order++,
      d.created_at || new Date().toISOString(),
      d.created_at || new Date().toISOString()
    );
  }
} catch (e) {
  console.error('documents→wiki migration:', e.message);
}

// Global app settings (timezone etc.)
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);
try {
  const tzRow = db.prepare("SELECT value FROM app_settings WHERE key = 'timezone'").get();
  if (!tzRow) {
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('timezone', 'Asia/Yekaterinburg')"
    ).run();
  }
} catch (e) {
  console.error('app_settings seed:', e.message);
}

// Client portal: share token + visit stats + client-visible tasks
try {
  db.prepare('SELECT client_token FROM projects LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE projects ADD COLUMN client_token TEXT DEFAULT ''");
}
try {
  db.prepare('SELECT client_portal_enabled FROM projects LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE projects ADD COLUMN client_portal_enabled INTEGER DEFAULT 0');
}
try {
  db.prepare('SELECT client_stats_enabled FROM projects LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE projects ADD COLUMN client_stats_enabled INTEGER DEFAULT 1');
}
try {
  db.prepare('SELECT client_site_url FROM projects LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE projects ADD COLUMN client_site_url TEXT DEFAULT ''");
}
try {
  db.prepare('SELECT client_visible FROM tasks LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE tasks ADD COLUMN client_visible INTEGER DEFAULT 1');
}
db.exec(`
  CREATE TABLE IF NOT EXISTS client_link_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    UNIQUE(project_id, day)
  );
`);

try {
  db.prepare('SELECT client_preview_token FROM projects LIMIT 1').get();
} catch (e) {
  db.exec("ALTER TABLE projects ADD COLUMN client_preview_token TEXT DEFAULT ''");
}
try {
  db.prepare('SELECT client_token_expires_at FROM projects LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE projects ADD COLUMN client_token_expires_at TEXT');
}
try {
  db.prepare('SELECT client_token_revoked_at FROM projects LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE projects ADD COLUMN client_token_revoked_at TEXT');
}
try {
  db.prepare('SELECT client_id FROM projects LIMIT 1').get();
} catch (e) {
  db.exec('ALTER TABLE projects ADD COLUMN client_id TEXT');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT DEFAULT '',
    inn TEXT DEFAULT '',
    primary_email TEXT DEFAULT '',
    primary_phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS client_users (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT DEFAULT '',
    telegram_id TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'viewer',
    auth_method TEXT NOT NULL DEFAULT 'link',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS client_access_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    client_id TEXT DEFAULT '',
    client_user_id TEXT DEFAULT '',
    token TEXT NOT NULL,
    preview_token TEXT DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'view_and_edit_site',
    expires_at TEXT,
    revoked_at TEXT,
    last_used_at TEXT,
    created_by TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token)
  );
  CREATE INDEX IF NOT EXISTS idx_cal_project ON client_access_links(project_id);
  CREATE INDEX IF NOT EXISTS idx_cal_preview ON client_access_links(preview_token);
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact TEXT NOT NULL,
    kind TEXT DEFAULT '',
    task TEXT NOT NULL,
    ip TEXT DEFAULT '',
    ua TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    project_id TEXT DEFAULT '',
    client_id TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(ip, created_at);
  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    comment TEXT DEFAULT '',
    actor TEXT DEFAULT '',
    actor_kind TEXT DEFAULT 'client',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id);
  CREATE TABLE IF NOT EXISTS client_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT DEFAULT '',
    author_kind TEXT NOT NULL DEFAULT 'client',
    author_name TEXT DEFAULT '',
    body TEXT NOT NULL,
    client_visible INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_comments_project ON client_comments(project_id);
`);

function newId() {
  return require('crypto').randomBytes(16).toString('hex');
}

try {
  const unnamed = db.prepare(`
    SELECT DISTINCT client FROM projects
    WHERE IFNULL(client,'') != '' AND IFNULL(client_id,'') = ''
  `).all();
  const findClient = db.prepare('SELECT id FROM clients WHERE name = ? LIMIT 1');
  const insClient = db.prepare(`
    INSERT INTO clients (id, name, primary_phone, created_at, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const setPid = db.prepare('UPDATE projects SET client_id = ? WHERE client = ? AND IFNULL(client_id,\'\') = \'\'');
  for (const row of unnamed) {
    const existing = findClient.get(row.client);
    const cid = existing ? existing.id : newId();
    if (!existing) {
      const phoneRow = db.prepare('SELECT phone FROM projects WHERE client = ? LIMIT 1').get(row.client);
      insClient.run(cid, row.client, (phoneRow && phoneRow.phone) || '');
    }
    setPid.run(cid, row.client);
  }
} catch (e) {
  console.error('clients seed from projects.client:', e.message);
}

try {
  const projectsWithToken = db.prepare(`
    SELECT id, client_id, client_token, client_preview_token, client_token_expires_at, client_token_revoked_at
    FROM projects WHERE IFNULL(client_token,'') != ''
  `).all();
  const hasLink = db.prepare('SELECT id FROM client_access_links WHERE token = ? LIMIT 1');
  const insLink = db.prepare(`
    INSERT INTO client_access_links
      (id, project_id, client_id, token, preview_token, scope, expires_at, revoked_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'view_and_edit_site', ?, ?, CURRENT_TIMESTAMP)
  `);
  for (const p of projectsWithToken) {
    if (hasLink.get(p.client_token)) continue;
    insLink.run(
      newId(),
      p.id,
      p.client_id || '',
      p.client_token,
      p.client_preview_token || '',
      p.client_token_expires_at || null,
      p.client_token_revoked_at || null
    );
  }
} catch (e) {
  console.error('client_access_links seed:', e.message);
}

module.exports = db;
