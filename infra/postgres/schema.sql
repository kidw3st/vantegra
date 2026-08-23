-- Vantegra CRM OLTP schema. Matches live SQLite crm.db (TEXT ids kept).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'manager',
    avatar TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notif_reminders INTEGER DEFAULT 1,
    notif_deadlines INTEGER DEFAULT 1,
    notif_overdue INTEGER DEFAULT 1,
    notif_deadline_week INTEGER DEFAULT 1,
    notif_deadline_day INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT DEFAULT '',
    inn TEXT DEFAULT '',
    primary_email TEXT DEFAULT '',
    primary_phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_users (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT DEFAULT '',
    telegram_id TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'viewer',
    auth_method TEXT NOT NULL DEFAULT 'link',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    client TEXT NOT NULL,
    phone TEXT DEFAULT '',
    amount DOUBLE PRECISION DEFAULT 0,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payment_due_date TEXT DEFAULT '',
    assignee TEXT DEFAULT '',
    client_token TEXT DEFAULT '',
    client_portal_enabled INTEGER DEFAULT 0,
    client_stats_enabled INTEGER DEFAULT 1,
    client_site_url TEXT DEFAULT '',
    client_preview_token TEXT DEFAULT '',
    client_token_expires_at TEXT,
    client_token_revoked_at TEXT,
    client_id TEXT
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    parent_id TEXT,
    date_end TEXT DEFAULT '',
    priority TEXT DEFAULT 'medium',
    description TEXT DEFAULT '',
    is_epic INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    updated_by TEXT DEFAULT '',
    client_visible INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS subtasks (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    name TEXT NOT NULL,
    done INTEGER DEFAULT 0,
    person TEXT DEFAULT '',
    deadline TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size TEXT DEFAULT '',
    file_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    doc_category TEXT DEFAULT 'client',
    template_category TEXT DEFAULT 'Другое'
);

CREATE TABLE IF NOT EXISTS calls (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
    id SERIAL PRIMARY KEY,
    project_id TEXT,
    task_id TEXT,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salaries (
    id SERIAL PRIMARY KEY,
    user_name TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    month TEXT NOT NULL,
    paid INTEGER DEFAULT 0,
    paid_date TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    pay_date TEXT DEFAULT '',
    payment_method TEXT DEFAULT 'transfer'
);

CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    date TEXT NOT NULL,
    person TEXT DEFAULT '',
    project_id TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    subcategory TEXT DEFAULT '',
    explanation TEXT DEFAULT '',
    recur_interval TEXT DEFAULT 'month',
    next_date TEXT DEFAULT '',
    is_recurring INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expense_categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER DEFAULT 0,
    is_system INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    project_id TEXT,
    type TEXT DEFAULT 'payment',
    message TEXT NOT NULL,
    remind_date TEXT NOT NULL DEFAULT '',
    is_sent INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expense_id INTEGER,
    notified INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    for_user TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS kanban_columns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'blue',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS task_columns (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'blue',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS calendar_statuses (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT 'blue',
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_name TEXT NOT NULL,
    actor TEXT DEFAULT '',
    action TEXT DEFAULT '',
    message TEXT NOT NULL,
    task_id TEXT,
    project_id TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_archived INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS integrations (
    id SERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'idle',
    last_check TIMESTAMPTZ,
    last_error TEXT DEFAULT '',
    meta TEXT DEFAULT '{}',
    secret_enc TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiki_pages (
    id SERIAL PRIMARY KEY,
    parent_id INTEGER,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    kind TEXT DEFAULT 'page',
    project_id TEXT,
    file_path TEXT DEFAULT '',
    file_type TEXT DEFAULT '',
    file_size TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_by TEXT DEFAULT '',
    updated_by TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiki_kinds (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    is_system INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    avatar TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_access_links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    client_id TEXT DEFAULT '',
    client_user_id TEXT DEFAULT '',
    token TEXT NOT NULL UNIQUE,
    preview_token TEXT DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'view_and_edit_site',
    expires_at TEXT,
    revoked_at TEXT,
    last_used_at TEXT,
    created_by TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_link_visits (
    id SERIAL PRIMARY KEY,
    project_id TEXT NOT NULL,
    day DATE NOT NULL,
    count INTEGER DEFAULT 0,
    UNIQUE (project_id, day)
);

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    comment TEXT DEFAULT '',
    actor TEXT DEFAULT '',
    actor_kind TEXT DEFAULT 'client',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at TEXT
);

CREATE TABLE IF NOT EXISTS client_comments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT DEFAULT '',
    author_kind TEXT NOT NULL DEFAULT 'client',
    author_name TEXT DEFAULT '',
    body TEXT NOT NULL,
    client_visible INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_name, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_user_arch ON notifications(user_name, is_archived, id);
CREATE INDEX IF NOT EXISTS idx_cal_project ON client_access_links(project_id);
CREATE INDEX IF NOT EXISTS idx_cal_preview ON client_access_links(preview_token);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_ip ON leads(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals(project_id);
CREATE INDEX IF NOT EXISTS idx_comments_project ON client_comments(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
