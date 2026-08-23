/**
 * WebAgency CRM - Main Application
 * Full CRUD functionality with API backend
 */

// ==================== TIMEZONE (default: Perm) ====================
window.CrmTime = (function () {
    const DEFAULT_TZ = 'Asia/Yekaterinburg';
    let tz = localStorage.getItem('crm_timezone') || DEFAULT_TZ;

    function normalize(t) {
        return (t && String(t).trim()) || DEFAULT_TZ;
    }
    function setTimezone(t) {
        tz = normalize(t);
        try { localStorage.setItem('crm_timezone', tz); } catch (e) {}
        window.CRM_TZ = tz;
        return tz;
    }
    function getTimezone() { return tz; }

    function parts(date) {
        const d = date instanceof Date ? date : new Date(date);
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const map = {};
        for (const p of fmt.formatToParts(d)) {
            if (p.type !== 'literal') map[p.type] = p.value;
        }
        let hour = map.hour || '00';
        if (hour === '24') hour = '00';
        return {
            year: map.year, month: map.month, day: map.day,
            hour, minute: map.minute || '00', second: map.second || '00'
        };
    }
    function todayISO() {
        const p = parts(new Date());
        return p.year + '-' + p.month + '-' + p.day;
    }
    function nowTime() {
        const p = parts(new Date());
        return p.hour + ':' + p.minute + ':' + p.second;
    }
    function addDaysISO(dateStr, days) {
        if (!dateStr) return '';
        const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return '';
        const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(days) || 0)));
        return dt.toISOString().slice(0, 10);
    }
    function formatDateTime(value) {
        if (value == null || value === '') return '';
        let raw = String(value).trim();
        if (!raw.includes('T') && /^\d{4}-\d{2}-\d{2} /.test(raw)) {
            raw = raw.replace(' ', 'T') + 'Z';
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            return raw.slice(8, 10) + '.' + raw.slice(5, 7) + '.' + raw.slice(0, 4);
        }
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return String(value);
        const p = parts(d);
        return p.day + '.' + p.month + '.' + p.year + ' ' + p.hour + ':' + p.minute;
    }
    function formatDate(value) {
        if (!value) return '';
        const s = String(value).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            return s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4);
        }
        return formatDateTime(value).slice(0, 10);
    }

    setTimezone(tz);
    return {
        DEFAULT_TZ, getTimezone, setTimezone, todayISO, nowTime,
        addDaysISO, formatDateTime, formatDate, parts
    };
})();

// ==================== DARK MODE ====================
function initTheme() {
    const saved = localStorage.getItem('crm_theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
}

function themeIconSvg(isDark) {
    // isDark = currently dark → show sun (switch to light)
    return isDark
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
}

/** Persist open drafts / editors before theme flip (no page reload). */
function flushUiStateBeforeTheme() {
    try {
        document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.blur();
        });
        document.querySelectorAll('input, textarea, select').forEach(el => {
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        if (typeof window.__crmFlushDrafts === 'function') window.__crmFlushDrafts();
        if (typeof window.__crmAutosave === 'function') window.__crmAutosave();
    } catch (e) {}
}

function refreshThemeChrome() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('.header-icon-btn[onclick*="toggleTheme"], #themeToggleBtn').forEach(btn => {
        btn.innerHTML = themeIconSvg(isDark);
        const label = isDark ? 'Светлая тема' : 'Тёмная тема';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    });
    // Settings theme buttons, if on page
    document.querySelectorAll('[onclick*="setTheme(\'light\')"]').forEach(b => {
        b.classList.toggle('btn-primary', !isDark);
        b.classList.toggle('btn-secondary', isDark);
    });
    document.querySelectorAll('[onclick*="setTheme(\'dark\')"]').forEach(b => {
        b.classList.toggle('btn-primary', isDark);
        b.classList.toggle('btn-secondary', !isDark);
    });
}

function applyTheme(theme) {
    flushUiStateBeforeTheme();
    const next = theme === 'dark' ? 'dark' : 'light';
    if (next === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('crm_theme', 'dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('crm_theme', 'light');
    }
    refreshThemeChrome();
    window.dispatchEvent(new CustomEvent('crm-theme-change', { detail: { theme: next } }));
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    applyTheme(isDark ? 'light' : 'dark');
}
window.applyTheme = applyTheme;

// ==================== SIDEBAR COMPONENT ====================
function renderSidebar(activePage) {
    const user = API.getCurrentUser();
    const avatar = user ? user.avatar : 'АИ';
    const name = user ? user.name : 'Админ';
    const role = user ? user.role : 'admin';
    
    return `
    <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <div class="sidebar-logo">
                <div class="logo-icon">
                    <img class="logo-mark" src="/assets/img/logo.png" alt="" width="28" height="28">
                </div>
                <div class="logo-text">
                    <span class="logo-name">Vantegra</span>
                    <span class="logo-sub">CRM</span>
                </div>
            </div>
        </div>
        <nav class="sidebar-nav">
            <div class="nav-section">
                <div class="nav-section-title">Главное</div>
                <a href="/pages/dashboard.html" class="nav-item${activePage === 'dashboard' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                    <span>Дашборд</span>
                </a>
                <a href="/pages/leads.html" class="nav-item${activePage === 'leads' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5"/></svg>
                    <span>Заявки</span>
                </a>
                <a href="/pages/projects.html" class="nav-item${activePage === 'projects' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                    <span>Проекты</span>
                    <span class="nav-badge" id="projectsBadge">0</span>
                </a>
                <a href="/pages/tasks.html" class="nav-item${activePage === 'tasks' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                    <span>Задачи</span>
                    <span class="nav-badge warning" id="tasksBadge">0</span>
                </a>
                <a href="/pages/goals.html" class="nav-item${activePage === 'goals' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                    <span>Цели</span>
                </a>
            </div>
            <div class="nav-section">
                <div class="nav-section-title">Работа</div>
                <a href="/pages/documents.html" class="nav-item${activePage === 'documents' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
                    <span>Документы</span>
                </a>
                <a href="/pages/calendar.html" class="nav-item${activePage === 'calendar' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <span>Календарь</span>
                </a>
                <a href="/pages/money.html" class="nav-item${activePage === 'money' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                    <span>Финансы</span>
                </a>
            </div>
            <div class="nav-section">
                <div class="nav-section-title">Система</div>
                <a href="/pages/settings.html" class="nav-item${activePage === 'settings' ? ' active' : ''}">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                    <span>Настройки</span>
                </a>
                <a href="/pages/integrations.html" class="nav-item${activePage === 'integrations' ? ' active' : ''}" title="Интеграции: GitHub, сервер, нейросети">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z"/>
                        <path d="M12 6.2V4.5M12 19.5v-1.7M6.2 12H4.5M19.5 12h-1.7"/>
                        <path d="M7.05 7.05l-1.2-1.2M18.15 18.15l-1.2-1.2M7.05 16.95l-1.2 1.2M18.15 5.85l-1.2 1.2"/>
                        <path d="M16.5 4.2a8.2 8.2 0 015.3 7" stroke-linecap="round"/>
                        <path d="M20.5 9.2l1.3 2-2.2.4" stroke-linecap="round" stroke-linejoin="round"/>
                        <path d="M7.5 19.8a8.2 8.2 0 01-5.3-7" stroke-linecap="round"/>
                        <path d="M3.5 14.8l-1.3-2 2.2-.4" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>Интеграции</span>
                </a>
            </div>
        </nav>
        <div class="sidebar-footer">
            <div class="sidebar-user">
                <div class="user-avatar"><span>${avatar}</span></div>
                <div class="user-info">
                    <div class="user-name">${name}</div>
                    <div class="user-role">${role === 'admin' ? 'Администратор' : (role === 'manager' ? 'Менеджер' : 'Пользователь')}</div>
                </div>
            </div>
        </div>
    </aside>`;
}

// ==================== HEADER COMPONENT ====================
function renderHeader() {
    const user = API.getCurrentUser();
    const avatar = user ? user.avatar : 'АИ';
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    return `
    <div class="main-wrapper">
        <header class="header">
            <div class="header-left">
                <button class="sidebar-toggle" id="sidebarToggle" aria-label="Меню">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
                </button>
                <div class="header-search" id="globalSearchWrap">
                    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input type="text" class="search-input" id="globalSearchInput" placeholder="Поиск… Ctrl+K" aria-label="Поиск" autocomplete="off">
                    <div class="search-dropdown" id="globalSearchDropdown" hidden></div>
                </div>
            </div>
            <div class="header-right">
                <div class="header-hotkeys">
                    <button class="header-icon-btn header-hot-btn" id="hotkeysBtn" title="Хоткеи" aria-label="Хоткеи" aria-expanded="false">HOT</button>
                    <div class="hotkeys-dropdown" id="hotkeysDropdown">
                        <div class="hotkeys-header">Хоткеи</div>
                        <div class="hotkeys-settings" id="hotkeysSettings"></div>
                        <div class="hotkeys-list" id="hotkeysList"></div>
                    </div>
                </div>
                <button class="header-icon-btn" id="themeToggleBtn" onclick="toggleTheme()" title="${isDark ? 'Светлая тема' : 'Тёмная тема'}" aria-label="${isDark ? 'Светлая тема' : 'Тёмная тема'}">
                    ${themeIconSvg(isDark)}
                </button>
                <div class="header-notifications">
                    <button class="header-icon-btn" id="notifBtn" title="Уведомления" aria-label="Уведомления">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                        <span class="notif-badge" id="notifBadge" aria-hidden="true">0</span>
                    </button>
                    <div class="notif-dropdown" id="notifDropdown">
                        <div class="notif-header">
                            <span>Уведомления</span>
                            <div style="display:flex;gap:2px;align-items:center;">
                                <button class="notif-clear" id="notifLoadMore" onclick="loadMoreNotifications(event)" title="Загрузить из архива" aria-label="Загрузить из архива" style="padding:4px 6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
                                <button class="notif-clear" onclick="markAllNotificationsRead(event)" title="Прочитать все" aria-label="Прочитать все" style="padding:4px 6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg></button>
                                <button class="notif-clear" onclick="deleteAllNotifications(event)" title="Удалить все" aria-label="Удалить все" style="padding:4px 6px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                            </div>
                        </div>
                        <div class="notif-list" id="notifList"></div>
                    </div>
                </div>
                <div class="header-user-menu">
                    <button class="header-user-btn" id="userMenuBtn" aria-label="Меню пользователя"><div class="header-avatar">${avatar}</div></button>
                    <div class="user-dropdown" id="userDropdown">
                        <a href="/pages/settings.html" class="dropdown-item"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg> Настройки</a>
                        <div class="dropdown-divider"></div>
                        <div class="dropdown-item app-version-row" id="appVersionRow" title="Версия CRM" style="opacity:0.7;cursor:default;pointer-events:none;">v…</div>
                        <a href="#" class="dropdown-item danger" onclick="API.logout()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Выйти</a>
                    </div>
                </div>
            </div>
        </header>
        <main class="main-content">
            <div class="content-wrapper">`;
}

// ==================== NAV TRAIL (breadcrumbs by real path) ====================
window.NavTrail = {
    KEY: 'crm_nav_trail',
    SECTIONS: {
        dashboard: { label: 'Дашборд', href: '/pages/dashboard.html' },
        projects: { label: 'Проекты', href: '/pages/projects.html' },
        project: { label: 'Проекты', href: '/pages/projects.html' },
        tasks: { label: 'Задачи', href: '/pages/tasks.html' },
        task: { label: 'Задачи', href: '/pages/tasks.html' },
        goals: { label: 'Цели', href: '/pages/goals.html' },
        goal: { label: 'Цели', href: '/pages/goals.html' },
        documents: { label: 'Документы', href: '/pages/documents.html' },
        calendar: { label: 'Календарь', href: '/pages/calendar.html' },
        money: { label: 'Финансы', href: '/pages/money.html' },
        settings: { label: 'Настройки', href: '/pages/settings.html' },
        integrations: { label: 'Интеграции', href: '/pages/integrations.html' }
    },
    get() {
        try {
            const raw = sessionStorage.getItem(this.KEY);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
    },
    save(items) {
        try { sessionStorage.setItem(this.KEY, JSON.stringify(items.slice(-8))); } catch (e) {}
    },
    reset(sectionKey) {
        const s = this.SECTIONS[sectionKey];
        if (s) this.save([{ label: s.label, href: s.href }]);
        else this.save([]);
    },
    pageKeyFromPath(pathname) {
        const file = String(pathname || '').split('/').pop() || '';
        const map = {
            'dashboard.html': 'dashboard',
            'projects.html': 'projects',
            'project.html': 'project',
            'tasks.html': 'tasks',
            'task.html': 'task',
            'goals.html': 'goals',
            'goal.html': 'goal',
            'documents.html': 'documents',
            'calendar.html': 'calendar',
            'calendar-day.html': 'calendar',
            'money.html': 'money',
            'settings.html': 'settings',
            'integrations.html': 'integrations'
        };
        return map[file] || '';
    },
    isListPage(key) {
        return ['dashboard', 'projects', 'tasks', 'goals', 'documents', 'calendar', 'money', 'settings', 'integrations'].includes(key);
    },
    isDetailPage(key) {
        return key === 'project' || key === 'task' || key === 'goal';
    },
    currentCrumbLabel() {
        const title = document.querySelector('.page-title');
        const t = (title && title.textContent || '').replace(/\s+/g, ' ').trim();
        return t.slice(0, 80);
    },
    /** Call before navigating to href from current page */
    prepareNavigate(href, label) {
        try {
            const url = new URL(href, location.origin);
            if (!url.pathname.includes('/pages/')) return;
            const toKey = this.pageKeyFromPath(url.pathname);
            const fromKey = this.pageKeyFromPath(location.pathname);
            if (!toKey) return;
            if (this.isListPage(toKey) && toKey !== 'calendar') {
                this.reset(toKey);
                return;
            }
            let trail = this.get();
            const here = location.pathname + location.search;

            // From list/dashboard: start trail from that page only (no fake middles)
            if (this.isListPage(fromKey)) {
                const s = this.SECTIONS[fromKey];
                trail = s ? [{ label: s.label, href: here }] : [];
            } else if (this.isDetailPage(fromKey)) {
                // Project → epic → child → grandchild: keep chain, pin current page
                const hereLabel = this.currentCrumbLabel()
                    || (this.SECTIONS[fromKey] && this.SECTIONS[fromKey].label)
                    || '…';
                const idx = trail.findIndex(c => c.href === here);
                if (idx >= 0) {
                    trail = trail.slice(0, idx + 1);
                    trail[idx].label = hereLabel || trail[idx].label;
                } else {
                    trail.push({ label: hereLabel, href: here });
                }
            } else if (!trail.length && fromKey) {
                const s = this.SECTIONS[fromKey];
                if (s) trail = [{ label: s.label, href: s.href }];
            }

            const crumb = {
                label: (label || '').trim().slice(0, 80) || url.pathname,
                href: url.pathname + url.search
            };
            // Navigating to an existing crumb (back) — truncate
            const existIdx = trail.findIndex(c => c.href === crumb.href);
            if (existIdx >= 0) {
                trail = trail.slice(0, existIdx);
            }
            if (trail.length && trail[trail.length - 1].href === crumb.href) {
                trail[trail.length - 1] = crumb;
            } else {
                trail.push(crumb);
            }
            this.save(trail);
        } catch (e) {}
    },
    /**
     * On task page load: keep click-path if last crumb is parent/project,
     * otherwise rebuild Projects → Project → parent chain.
     */
    syncTaskTrail(task, project) {
        if (!task || !task.id) return;
        const here = '/pages/task.html?id=' + encodeURIComponent(task.id);
        let trail = this.get().filter(c => c && c.href !== here);
        const parentHref = task.parent_id
            ? '/pages/task.html?id=' + encodeURIComponent(task.parent_id)
            : '';
        const projectHref = project && project.id
            ? '/pages/project.html?id=' + encodeURIComponent(project.id)
            : '';
        const last = trail[trail.length - 1];
        const lastOk = last && (
            (parentHref && last.href === parentHref) ||
            (!task.parent_id && projectHref && last.href === projectHref) ||
            (!task.parent_id && !projectHref && /\/tasks\.html/.test(last.href)) ||
            (!task.parent_id && /\/dashboard\.html/.test(last.href)) ||
            (!task.parent_id && /\/calendar-day\.html/.test(last.href))
        );
        if (lastOk) {
            this.save(trail);
            return;
        }
        // Structural fallback: section → project → ancestors
        const chain = [];
        if (project && project.id) {
            chain.push({ label: 'Проекты', href: '/pages/projects.html' });
            chain.push({
                label: (project.name || 'Проект').slice(0, 80),
                href: projectHref
            });
        } else {
            chain.push({ label: 'Задачи', href: '/pages/tasks.html' });
        }
        const byId = {};
        try {
            (typeof CRM !== 'undefined' && CRM.getTasks ? CRM.getTasks() : []).forEach(t => {
                if (t && t.id) byId[t.id] = t;
            });
        } catch (e) {}
        const ancestors = [];
        let pid = task.parent_id;
        let guard = 0;
        while (pid && guard++ < 40) {
            const p = byId[pid];
            if (!p) break;
            ancestors.unshift({
                label: String(p.name || 'Задача').slice(0, 80),
                href: '/pages/task.html?id=' + encodeURIComponent(p.id)
            });
            pid = p.parent_id;
        }
        this.save(chain.concat(ancestors));
    },
    /** HTML crumbs ending with currentLabel (not a link) */
    render(currentLabel) {
        let trail = this.get();
        const cur = String(currentLabel || '').trim();
        const here = location.pathname + location.search;
        if (trail.length && trail[trail.length - 1].href === here) {
            trail = trail.slice(0, -1);
        }
        if (!trail.length) {
            const key = this.pageKeyFromPath(location.pathname);
            const s = this.SECTIONS[key];
            if (s && !this.isListPage(key)) {
                trail = [{ label: s.label, href: s.href }];
            }
        }
        if (!trail.length && !cur) return '';
        const sep = '<span class="text-sm text-muted" style="margin:0 8px;">/</span>';
        const parts = [];
        trail.forEach((c, i) => {
            if (i) parts.push(sep);
            parts.push(`<a href="${escapeHtmlAttr(c.href)}" class="text-sm text-muted nav-trail-link">${escapeHtmlText(c.label)}</a>`);
        });
        if (cur) {
            if (trail.length) parts.push(sep);
            parts.push(`<span class="text-sm fw-600">${escapeHtmlText(cur)}</span>`);
        }
        return `<div class="nav-trail" style="margin-bottom:10px;display:flex;align-items:center;flex-wrap:wrap;">${parts.join('')}</div>`;
    }
};

/** Navigate with breadcrumb capture (use instead of location.href for in-app links) */
window.crmGo = function(href, label) {
    if (typeof NavTrail !== 'undefined') NavTrail.prepareNavigate(href, label || '');
    window.location.href = href;
};

function initNavTrailCapture() {
    if (window._navTrailBound) return;
    window._navTrailBound = true;
    document.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href*="/pages/"]');
        if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#')) return;
        const label = a.getAttribute('data-nav-label')
            || a.getAttribute('title')
            || (a.querySelector('.cal-day-item-title, .task-name, .db-row-title') || a).textContent;
        NavTrail.prepareNavigate(href, String(label || '').replace(/\s+/g, ' ').trim());
    }, true);
}

// ==================== GLOBAL SEARCH ====================
function initGlobalSearch() {
    const input = document.getElementById('globalSearchInput');
    const dd = document.getElementById('globalSearchDropdown');
    if (!input || !dd || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    let timer = null;
    let seq = 0;

    const typeLabel = {
        project: 'Проект', task: 'Задача', goal: 'Цель',
        document: 'Документ', reminder: 'Напоминание', expense: 'Расход'
    };

    function hide() { dd.hidden = true; dd.innerHTML = ''; }

    function renderItems(items, q) {
        if (!items.length) {
            dd.innerHTML = `<div class="search-empty">Ничего не найдено по «${escapeHtmlText(q)}»</div>`;
            dd.hidden = false;
            return;
        }
        dd.innerHTML = items.map((it, idx) => `
            <button type="button" class="search-item" data-href="${escapeHtmlAttr(it.href)}" data-idx="${idx}">
                <span class="search-item-type">${escapeHtmlText(typeLabel[it.type] || it.type)}</span>
                <span class="search-item-title">${escapeHtmlText(it.title)}</span>
                ${it.subtitle ? `<span class="search-item-sub">${escapeHtmlText(it.subtitle)}</span>` : ''}
            </button>`).join('');
        dd.hidden = false;
        dd.querySelectorAll('.search-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const href = btn.getAttribute('data-href');
                if (!href) return;
                NavTrail.prepareNavigate(href, btn.querySelector('.search-item-title')?.textContent || '');
                location.href = href;
            });
        });
    }

    async function runSearch(q) {
        const my = ++seq;
        if (!q || q.length < 1) { hide(); return; }
        try {
            const data = await API.get('/api/search?q=' + encodeURIComponent(q) + '&limit=12');
            if (my !== seq) return;
            renderItems((data && data.items) || [], q);
        } catch (e) {
            if (my !== seq) return;
            dd.innerHTML = '<div class="search-empty">Ошибка поиска</div>';
            dd.hidden = false;
        }
    }

    input.addEventListener('input', () => {
        clearTimeout(timer);
        const q = input.value.trim();
        timer = setTimeout(() => runSearch(q), 180);
    });
    input.addEventListener('focus', () => {
        if (input.value.trim()) runSearch(input.value.trim());
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { hide(); input.blur(); }
        if (e.key === 'Enter') {
            const first = dd.querySelector('.search-item');
            if (first) { e.preventDefault(); first.click(); }
        }
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#globalSearchWrap')) hide();
    });
}

// ==================== INIT COMMON UI ====================
/** Floating tooltips for [data-tip] — rendered in body, never clipped by cards. */
function initDataTipTooltips() {
    if (window._crmTipsInit) return;
    window._crmTipsInit = true;
    let bubble = document.getElementById('crmTipBubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.id = 'crmTipBubble';
        bubble.setAttribute('role', 'tooltip');
        document.body.appendChild(bubble);
    }
    let hideTimer = null;
    let activeEl = null;

    function hide() {
        bubble.classList.remove('is-on');
        activeEl = null;
    }

    function place(el) {
        const text = (el.getAttribute('data-tip') || '').trim();
        if (!text) { hide(); return; }
        activeEl = el;
        bubble.textContent = text;
        bubble.classList.add('is-on');
        const r = el.getBoundingClientRect();
        const pad = 8;
        // Measure after content set
        const bw = bubble.offsetWidth || 160;
        const bh = bubble.offsetHeight || 32;
        let left = r.left + r.width / 2 - bw / 2;
        left = Math.max(pad, Math.min(window.innerWidth - bw - pad, left));
        let top = r.top - bh - 8;
        if (top < pad) top = r.bottom + 8; // flip below if no room above
        if (top + bh > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - bh - pad);
        bubble.style.left = Math.round(left) + 'px';
        bubble.style.top = Math.round(top) + 'px';
    }

    function findTipEl(node) {
        if (!node || !node.closest) return null;
        return node.closest('[data-tip]');
    }

    document.addEventListener('mouseover', (e) => {
        const el = findTipEl(e.target);
        if (!el) return;
        clearTimeout(hideTimer);
        place(el);
    });
    document.addEventListener('mouseout', (e) => {
        const from = findTipEl(e.target);
        if (!from) return;
        const to = findTipEl(e.relatedTarget);
        if (to === from) return;
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 80);
    });
    document.addEventListener('scroll', () => { if (activeEl) place(activeEl); }, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

function initCommonUI() {
    // Badges must refresh on every call: pages re-render the whole #app on tab
    // switches, which resets the badge elements to their "0" template values
    updateBadges();
    initGlobalSearch();
    initDataTipTooltips();
    // Version + timezone (re-rendered with header)
    (async () => {
        const el = document.getElementById('appVersionRow');
        try {
            const info = await API.get('/api/app-info');
            if (info && info.timezone && window.CrmTime) {
                CrmTime.setTimezone(info.timezone);
            }
            const v = (info && info.version) || '—';
            window.CRM_APP_VERSION = v;
            if (el) {
                el.textContent = 'v' + v;
                const tzLabel = (info && info.timezoneLabel) || (info && info.timezone) || '';
                el.title = 'Vantegra CRM ' + v + (tzLabel ? ' · ' + tzLabel : '');
            }
        } catch (e) {
            if (el) el.textContent = 'v—';
        }
    })();

    if (window._commonUIInit) return;
    window._commonUIInit = true;
    initNavTrailCapture();

    // Overlay for mobile sidebar (lives outside #app, so created once)
    const sidebarOverlay = document.createElement('div');
    sidebarOverlay.className = 'sidebar-overlay';
    document.body.appendChild(sidebarOverlay);
    sidebarOverlay.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('show');
    });

    function closeAll() {
        document.querySelectorAll('.notif-dropdown.show, .user-dropdown.show, .hotkeys-dropdown.show').forEach(d => d.classList.remove('show'));
        const hotBtn = document.getElementById('hotkeysBtn');
        if (hotBtn) hotBtn.setAttribute('aria-expanded', 'false');
    }

    // All header/sidebar clicks are delegated to document so they keep working
    // after pages replace the whole DOM via app.innerHTML = ...
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');

        const navItem = e.target.closest('.sidebar-nav .nav-item[href]');
        if (navItem) {
            const key = NavTrail.pageKeyFromPath(navItem.getAttribute('href') || '');
            if (key) NavTrail.reset(key);
        }

        if (e.target.closest('#sidebarToggle')) {
            if (sidebar) {
                sidebar.classList.toggle('open');
                sidebarOverlay.classList.toggle('show');
            }
            return;
        }

        if (e.target.closest('#hotkeysBtn')) {
            const dd = document.getElementById('hotkeysDropdown');
            const btn = document.getElementById('hotkeysBtn');
            const wasOpen = dd && dd.classList.contains('show');
            closeAll();
            if (dd && !wasOpen) {
                renderHotkeysPanel();
                dd.classList.add('show');
                if (btn) btn.setAttribute('aria-expanded', 'true');
            }
            return;
        }

        if (e.target.closest('#notifBtn')) {
            const dd = document.getElementById('notifDropdown');
            const wasOpen = dd && dd.classList.contains('show');
            closeAll();
            if (dd && !wasOpen) {
                dd.classList.add('show');
                refreshNotifList(true);
            }
            return;
        }

        if (e.target.closest('#userMenuBtn')) {
            const dd = document.getElementById('userDropdown');
            const wasOpen = dd && dd.classList.contains('show');
            closeAll();
            if (dd && !wasOpen) dd.classList.add('show');
            return;
        }

        if (e.target.closest('.hotkeys-dropdown')) return;

        closeAll();

        if (sidebar && sidebar.classList.contains('open') && !sidebar.contains(e.target)) {
            sidebar.classList.remove('open');
            sidebarOverlay.classList.remove('show');
        }

        // Tabs (.tab-btn with data-tab)
        const tabBtn = e.target.closest('.tabs .tab-btn');
        if (tabBtn) {
            const target = tabBtn.dataset.tab;
            if (target) {
                const group = tabBtn.closest('.tabs');
                group.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                tabBtn.classList.add('active');
                group.parentElement.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                const el = document.getElementById(target);
                if (el) el.classList.add('active');
            }
            return;
        }

        // Filter chips
        const chip = e.target.closest('.filter-bar .filter-chip');
        if (chip && !chip.classList.contains('cal-filter') && !chip.classList.contains('cal-filter-person')) {
            const bar = chip.closest('.filter-bar');
            bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        }
    });

    // Modal overlay — close only if mousedown+click both on backdrop
    // (so text selection that ends outside the modal does NOT close it)
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        let overlayMouseDownOnBackdrop = false;
        overlay.addEventListener('mousedown', (e) => {
            overlayMouseDownOnBackdrop = (e.target === overlay);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay && overlayMouseDownOnBackdrop) closeModal();
            overlayMouseDownOnBackdrop = false;
        });
        // Escape = как крестик: сброс черновика
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(true); });

        // Focus trap: auto-focus first element when modal opens
        const modalObserver = new MutationObserver(() => {
            if (overlay.classList.contains('show')) {
                const focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
                if (focusable.length) focusable[0].focus();
            }
        });
        modalObserver.observe(overlay, { attributes: true, attributeFilter: ['class'] });

        // Tab key trap within modal
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Tab' || !overlay.classList.contains('show')) return;
            const modal = overlay.querySelector('.modal');
            if (!modal) return;
            const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                last.focus();
                e.preventDefault();
            } else if (!e.shiftKey && document.activeElement === last) {
                first.focus();
                e.preventDefault();
            }
        });
    }

}

// Notification pagination: active inbox + soft-delete archive (current user only)
let _notifState = {
    activeOffset: 0,
    activeTotal: 0,
    archiveOffset: 0,
    archiveTotal: 0,
    unread: 0,
    reminderCount: 0,
    loading: false,
    archiveLabelShown: false
};

function resetNotifState() {
    _notifState = {
        activeOffset: 0,
        activeTotal: 0,
        archiveOffset: 0,
        archiveTotal: 0,
        unread: 0,
        reminderCount: 0,
        loading: false,
        archiveLabelShown: false
    };
}

function todayLocalISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function setNotifBadge(count) {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    const n = Math.max(0, Number(count) || 0);
    badge.textContent = String(n);
    badge.classList.toggle('is-on', n > 0);
    badge.setAttribute('aria-hidden', n > 0 ? 'false' : 'true');
}

function escapeNotifHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function plainNotifText(html) {
    if (typeof stripHtmlText === 'function') return stripHtmlText(html || '');
    return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function renderNotifItem(n) {
    let time = '';
    if (n.created_at) {
        const full = window.CrmTime ? CrmTime.formatDateTime(n.created_at) : '';
        if (full) {
            // DD.MM.YYYY HH:MM → DD.MM HH:MM
            time = full.replace(/^(\d{2}\.\d{2})\.\d{4}\s/, '$1 ');
        }
    }
    const tid = String(n.task_id || '').replace(/'/g, '');
    const pid = String(n.project_id || '').replace(/'/g, '');
    const archived = !!n.is_archived;
    return `<div class="notif-item${n.is_read || archived ? '' : ' unread'}${archived ? ' notif-archived' : ''}" data-notif-id="${n.id}" onclick="openNotification(event, ${n.id}, '${tid}', '${pid}')" style="cursor:pointer;">
        <div class="notif-dot"></div>
        <div class="notif-content">
            <p>${escapeNotifHtml(n.message)}</p>
            <span class="notif-time">${archived ? 'Архив · ' : ''}${escapeNotifHtml(time)}</span>
        </div>
    </div>`;
}

function renderReminderNotifItem(r) {
    const dateISO = (r.remind_date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.remind_date).slice(0, 10)))
        ? String(r.remind_date).slice(0, 10) : '';
    const dateLabel = dateISO
        ? new Date(dateISO + 'T12:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
        : '';
    const text = plainNotifText(r.message) || 'Напоминание';
    return `<div class="notif-item unread" data-reminder-id="${r.id}" data-remind-date="${escapeNotifHtml(dateISO)}" onclick="openReminderFromNotif(event, '${escapeNotifHtml(dateISO)}')" style="cursor:pointer;">
        <div class="notif-dot"></div>
        <div class="notif-content">
            <p>${escapeNotifHtml(text)}</p>
            <span class="notif-time">${escapeNotifHtml(dateLabel)}</span>
        </div>
        <button class="notif-dismiss" onclick="dismissNotification(${r.id}, event)" title="Закрыть" aria-label="Закрыть уведомление">&times;</button>
    </div>`;
}

function updateLoadMoreVisibility() {
    const btn = document.getElementById('notifLoadMore');
    if (!btn) return;
    btn.style.display = '';
    btn.disabled = !!_notifState.loading;
    btn.style.opacity = _notifState.loading ? '0.5' : '';
}

function isNotifDropdownOpen() {
    const dd = document.getElementById('notifDropdown');
    return !!(dd && dd.classList.contains('show'));
}

function applyActiveNotifPage(notifData, reminders) {
    _notifState.activeOffset = (notifData.items || []).length;
    _notifState.activeTotal = notifData.total || 0;
    _notifState.archiveOffset = 0;
    _notifState.archiveTotal = notifData.archiveTotal || 0;
    _notifState.unread = notifData.unread || 0;
    _notifState.reminderCount = (reminders || []).length;
    _notifState.archiveLabelShown = false;
    const list = document.getElementById('notifList');
    if (!list) return;
    let html = (reminders || []).map(renderReminderNotifItem).join('');
    html += (notifData.items || []).map(n => renderNotifItem({ ...n, is_archived: false })).join('');
    list.innerHTML = html || '<div style="padding:20px;text-align:center;font-size:0.85rem;color:var(--gray-400);">Нет уведомлений</div>';
    setNotifBadge(_notifState.reminderCount + _notifState.unread);
    updateLoadMoreVisibility();
}

/** Rebuild reminder + first page of active notifications */
async function refreshNotifList(force) {
    if (_notifState.loading) return;
    const list = document.getElementById('notifList');
    if (!list) return;
    if (!force && isNotifDropdownOpen()) return;
    _notifState.loading = true;
    try {
        let reminders = [];
        let notifData = { items: [], unread: 0, total: 0, archiveTotal: 0 };
        try { reminders = (await API.get('/api/reminders?active=true')) || []; } catch (err) {}
        try { notifData = (await API.get('/api/notifications?limit=10&offset=0&archived=0')) || notifData; } catch (err) {}
        applyActiveNotifPage(notifData, reminders);
    } finally {
        _notifState.loading = false;
        updateLoadMoreVisibility();
    }
}

// Update sidebar badges + notification dropdown
async function updateBadges() {
    try {
        const stats = await API.getStats();
        const projectsBadge = document.getElementById('projectsBadge');
        const tasksBadge = document.getElementById('tasksBadge');
        if (projectsBadge) projectsBadge.textContent = stats.activeProjects;
        if (tasksBadge) tasksBadge.textContent = stats.pendingTasks;

        let reminders = [];
        let notifData = { items: [], unread: 0, total: 0, archiveTotal: 0 };
        try { reminders = (await API.get('/api/reminders?active=true')) || []; } catch (err) {}
        try { notifData = (await API.get('/api/notifications?limit=10&offset=0&archived=0')) || notifData; } catch (err) {}
        _notifState.unread = notifData.unread || 0;
        _notifState.reminderCount = reminders.length;
        _notifState.activeTotal = notifData.total || 0;
        _notifState.archiveTotal = notifData.archiveTotal || 0;
        setNotifBadge(_notifState.reminderCount + _notifState.unread);

        if (!isNotifDropdownOpen()) {
            applyActiveNotifPage(notifData, reminders);
        }
    } catch (err) {
        console.error('Failed to update badges:', err);
    }
}

window.openReminderFromNotif = function(e, dateISO) {
    if (e && e.target && e.target.closest && e.target.closest('.notif-dismiss')) return;
    if (e) e.stopPropagation();
    const d = (dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO)) ? dateISO : todayLocalISO();
    window.location.href = '/pages/calendar-day.html?date=' + encodeURIComponent(d);
};

// Open the task/project a notification refers to
async function openNotification(e, id, taskId, projectId) {
    if (e) e.stopPropagation();
    try { await API.put(`/api/notifications/${id}/read`); } catch (err) {}
    if (taskId) {
        window.location.href = '/pages/task.html?id=' + encodeURIComponent(taskId);
    } else if (projectId) {
        window.location.href = '/pages/project.html?id=' + encodeURIComponent(projectId);
    } else {
        window.location.href = '/pages/tasks.html';
    }
}

// Mark all notifications as read (checkmark button)
async function markAllNotificationsRead(e) {
    if (e) e.stopPropagation();
    try {
        await API.put('/api/notifications/read-all');
        document.querySelectorAll('.notif-item[data-notif-id]:not(.notif-archived)').forEach(item => item.classList.remove('unread'));
        _notifState.unread = 0;
        setNotifBadge(_notifState.reminderCount || document.querySelectorAll('.notif-item[data-reminder-id]').length);
    } catch (err) {}
}

// Archive all active notifications + dismiss active reminders
async function deleteAllNotifications(e) {
    if (e) e.stopPropagation();
    try {
        await API.delete('/api/notifications/all');
        const reminderItems = [...document.querySelectorAll('.notif-item[data-reminder-id]')];
        for (const item of reminderItems) {
            try { await API.put(`/api/reminders/${item.dataset.reminderId}/sent`); } catch (err) {
                try { await API.delete(`/api/reminders/${item.dataset.reminderId}`); } catch (err2) {}
            }
        }
        const archTotal = (_notifState.activeTotal || 0) + (_notifState.archiveTotal || 0);
        resetNotifState();
        _notifState.archiveTotal = archTotal;
        const list = document.getElementById('notifList');
        if (list) list.innerHTML = '<div style="padding:20px;text-align:center;font-size:0.85rem;color:var(--gray-400);">Нет уведомлений · можно загрузить из архива</div>';
        setNotifBadge(0);
        updateLoadMoreVisibility();
        if (typeof showToast === 'function') showToast('Уведомления в архиве', 'info');
    } catch (err) {}
}

// Load more active, then archive (current user only)
async function loadMoreNotifications(e) {
    if (e) e.stopPropagation();
    if (_notifState.loading) return;
    _notifState.loading = true;
    updateLoadMoreVisibility();
    try {
        const list = document.getElementById('notifList');
        const clearEmpty = () => {
            if (!list) return;
            const empty = list.querySelector('div[style*="text-align:center"]');
            if (empty && !list.querySelector('.notif-item')) empty.remove();
        };

        // 1) More active inbox items
        if ((_notifState.activeOffset || 0) < (_notifState.activeTotal || 0)) {
            const data = await API.get(`/api/notifications?limit=10&offset=${_notifState.activeOffset}&archived=0`);
            if (data && data.items && data.items.length) {
                clearEmpty();
                if (list) list.insertAdjacentHTML('beforeend', data.items.map(n => renderNotifItem({ ...n, is_archived: false })).join(''));
                _notifState.activeOffset += data.items.length;
                _notifState.activeTotal = data.total;
                _notifState.archiveTotal = data.archiveTotal || _notifState.archiveTotal;
                if (typeof data.unread === 'number') _notifState.unread = data.unread;
                return;
            }
            _notifState.activeOffset = _notifState.activeTotal;
        }

        // 2) Archive (current user only)
        if ((_notifState.archiveOffset || 0) < (_notifState.archiveTotal || 0)) {
            const data = await API.get(`/api/notifications?limit=10&offset=${_notifState.archiveOffset || 0}&archived=1`);
            _notifState.archiveTotal = data?.total ?? 0;
            if (data && data.items && data.items.length) {
                clearEmpty();
                if (list && !_notifState.archiveLabelShown) {
                    list.insertAdjacentHTML('beforeend',
                        '<div class="notif-archive-sep" style="padding:8px 14px;font-size:0.75rem;color:var(--gray-400);border-top:1px solid var(--gray-100);">Архив</div>');
                    _notifState.archiveLabelShown = true;
                }
                if (list) list.insertAdjacentHTML('beforeend', data.items.map(n => renderNotifItem({ ...n, is_archived: true })).join(''));
                _notifState.archiveOffset += data.items.length;
                return;
            }
        }

        if (typeof showToast === 'function') showToast('В архиве больше нет уведомлений', 'info');
    } catch (err) {
        if (typeof showToast === 'function') showToast('Не удалось загрузить архив', 'error');
    } finally {
        _notifState.loading = false;
        updateLoadMoreVisibility();
    }
}

// Dismiss a single reminder from the notification tray
async function dismissNotification(reminderId, e) {
    if (e) e.stopPropagation();
    try {
        await API.delete(`/api/reminders/${reminderId}`);
        const item = document.querySelector(`.notif-item[data-reminder-id="${reminderId}"]`);
        if (item) {
            item.style.transition = 'opacity 0.2s, transform 0.2s';
            item.style.opacity = '0';
            item.style.transform = 'translateX(20px)';
            setTimeout(() => item.remove(), 200);
        }
        _notifState.reminderCount = Math.max(0, (_notifState.reminderCount || 1) - 1);
        setNotifBadge(_notifState.reminderCount + (_notifState.unread || 0));
        setTimeout(() => {
            const list = document.getElementById('notifList');
            if (list && !list.querySelector('.notif-item')) {
                list.innerHTML = '<div style="padding:20px;text-align:center;font-size:0.85rem;color:var(--gray-400);">Нет уведомлений</div>';
            }
        }, 250);
    } catch (err) {}
}

// ==================== STATUS HELPERS ====================
const statusColors = {
    'Новый': 'badge-primary',
    'Переговоры': 'badge-warning',
    'В работе': 'badge-success',
    'Абонемент': 'badge-info',
    'Выполнено': 'badge-gray'
};

const payStatusIcons = {
    'unpaid': { class: 'unpaid', title: 'Не оплачено' },
    'pending': { class: 'pending', title: 'Ждём оплату' },
    'paid': { class: 'paid', title: 'Оплачено' }
};

const payMethodClasses = {
    'Наличные': 'cash',
    'По счёту': 'invoice',
    'Рассрочка': 'installment'
};

const adequacyData = {
    'good': { emoji: '😊', label: 'Нормальный' },
    'warn': { emoji: '😐', label: 'Осторожно' },
    'bad': { emoji: '😡', label: 'Не работаем' }
};

function getStatusClass(status) {
    return statusColors[status] || 'badge-gray';
}

function formatAmount(amount) {
    return new Intl.NumberFormat('ru-RU').format(amount) + ' ₽';
}

// ==================== KANBAN DRAG & DROP ====================
function initKanban() {
    document.querySelectorAll('.kanban-card').forEach(card => {
        card.setAttribute('draggable', 'true');
        card.ondragstart = (e) => {
            document.body.classList.add('dnd-active');
            card.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.dataset.taskId || card.dataset.projectId || '');
        };
        card.ondragend = () => {
            document.body.classList.remove('dnd-active');
            card.classList.remove('dragging');
            updateKanbanCounts();
        };
    });

    document.querySelectorAll('.kanban-column-body').forEach(col => {
        col.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            col.style.background = 'rgba(99,102,241,0.05)';
        };
        col.ondragleave = () => { col.style.background = ''; };
        col.ondrop = async (e) => {
            e.preventDefault();
            document.body.classList.remove('dnd-active');
            col.style.background = '';
            const dragging = document.querySelector('.kanban-card.dragging');
            if (!dragging) return;

            const taskId = dragging.dataset.taskId;
            const projectId = dragging.dataset.projectId;
            const newColumn = col.dataset.column;

            if (taskId && newColumn) {
                try {
                    await CRM.updateTask(taskId, {
                        column_status: newColumn,
                        done: /готов|выполн|done/i.test(newColumn || '')
                    });
                    col.appendChild(dragging);
                    showToast('Статус: ' + newColumn, 'success');
                } catch (err) {
                    showToast('Ошибка: ' + (err.message || ''), 'error');
                }
            } else if (projectId && newColumn) {
                try {
                    const projects = await API.getProjects();
                    const project = projects.find(p => p.id === projectId);
                    if (project) {
                        await API.updateProject(projectId, { ...project, status: newColumn });
                        col.appendChild(dragging);
                        showToast('Статус: ' + newColumn, 'success');
                    }
                } catch (err) {
                    showToast('Ошибка: ' + (err.message || ''), 'error');
                }
            }
            updateKanbanCounts();
        };
    });
}

function updateKanbanCounts() {
    document.querySelectorAll('.kanban-column').forEach(c => {
        const badge = c.querySelector('.kanban-count');
        if (badge) badge.textContent = c.querySelectorAll('.kanban-card').length;
    });
}

// ==================== COPY TO CLIPBOARD ====================
function initCopyButtons() {
    document.querySelectorAll('.cred-copy').forEach(btn => {
        btn.addEventListener('click', () => {
            const block = btn.closest('.cred-block');
            if (!block) return;
            const txt = block.querySelector('.cred-value');
            if (!txt) return;
            navigator.clipboard.writeText(txt.textContent.trim()).then(() => {
                const orig = btn.innerHTML;
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
                setTimeout(() => { btn.innerHTML = orig; }, 1500);
            });
        });
    });
}

// ==================== BUTTON LOCK (prevent double-submit) ====================
async function withButtonLock(btnOrId, asyncFn) {
    const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
    if (!btn) return asyncFn();
    if (btn.disabled) return;
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Сохранение...';
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';
    try {
        return await asyncFn();
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
        btn.style.opacity = '';
        btn.style.pointerEvents = '';
    }
}

// ==================== UNDO DELETE (stacked toasts) ====================
const UndoDeleteStack = {
    items: [],
    ensureHost() {
        let host = document.getElementById('undoDeleteHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'undoDeleteHost';
            host.className = 'undo-delete-host';
            document.body.appendChild(host);
        }
        return host;
    },
    layout() {
        // Newest at bottom; older move up
        const host = this.ensureHost();
        const nodes = [...host.querySelectorAll('.undo-delete-toast')];
        nodes.forEach((el, i) => {
            const fromBottom = (nodes.length - 1 - i) * 76 + 24;
            el.style.bottom = fromBottom + 'px';
        });
    }
};

/**
 * Soft-delay delete with restore toast.
 *
 * New style:
 *   confirmDelete('Задача «X» удалена', { optimistic, commit, undo })
 * Legacy:
 *   confirmDelete('Удалить задачу?', async () => { await API.delete… })
 *
 * Item should disappear immediately (optimistic). After 5s commit runs.
 * Restore cancels commit and runs undo.
 */
function confirmDelete(message, onConfirmOrHandlers, maybeUndo) {
    let handlers;
    if (typeof onConfirmOrHandlers === 'function') {
        handlers = {
            commit: onConfirmOrHandlers,
            undo: typeof maybeUndo === 'function' ? maybeUndo : null
        };
    } else {
        handlers = onConfirmOrHandlers || {};
    }

    // Normalize label: "… Восстановить?"
    let label = String(message || 'Элемент удалён');
    if (/^удалить/i.test(label)) {
        const rest = label.replace(/^удалить\s*/i, '').replace(/\?+$/, '').trim();
        label = 'Удалено: ' + rest;
    }
    label = label.replace(/\?+$/, '');
    if (!/восстановить/i.test(label)) label += '. Восстановить?';

    try {
        if (typeof handlers.optimistic === 'function') handlers.optimistic();
    } catch (e) { console.error(e); }

    const host = UndoDeleteStack.ensureHost();
    const t = document.createElement('div');
    t.className = 'undo-delete-toast';
    let cancelled = false;
    let seconds = 5;
    t.innerHTML = `
        <span class="undo-delete-text">${label.replace(/</g, '&lt;')}</span>
        <button type="button" class="undo-delete-btn">Восстановить (${seconds})</button>`;
    host.appendChild(t);
    UndoDeleteStack.items.push(t);
    UndoDeleteStack.layout();

    const undoBtn = t.querySelector('.undo-delete-btn');
    const interval = setInterval(() => {
        seconds--;
        if (undoBtn) undoBtn.textContent = `Восстановить (${seconds})`;
        if (seconds <= 0) {
            clearInterval(interval);
            if (!cancelled) {
                t.style.opacity = '0';
                t.style.transform = 'translateY(8px)';
                setTimeout(async () => {
                    t.remove();
                    UndoDeleteStack.items = UndoDeleteStack.items.filter(x => x !== t);
                    UndoDeleteStack.layout();
                    try {
                        if (typeof handlers.commit === 'function') await handlers.commit();
                    } catch (err) {
                        if (typeof showToast === 'function') showToast(err.message || 'Ошибка удаления', 'error');
                        try { if (typeof handlers.undo === 'function') handlers.undo(); } catch (e2) {}
                    }
                }, 250);
            }
        }
    }, 1000);

    undoBtn.addEventListener('click', () => {
        cancelled = true;
        clearInterval(interval);
        t.style.opacity = '0';
        setTimeout(() => {
            t.remove();
            UndoDeleteStack.items = UndoDeleteStack.items.filter(x => x !== t);
            UndoDeleteStack.layout();
        }, 250);
        try {
            if (typeof handlers.undo === 'function') handlers.undo();
            else if (typeof showToast === 'function') showToast('Удаление отменено', 'info');
        } catch (e) { console.error(e); }
    });
}

// ==================== FORM VALIDATION ====================
function validateForm(fields) {
    let valid = true;
    fields.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        el.classList.remove('invalid');
        const group = el.closest('.form-group');
        if (group) group.classList.remove('has-error');

        const val = el.value.trim();
        if (f.required && !val) {
            el.classList.add('invalid');
            if (group) {
                group.classList.add('has-error');
                let errEl = group.querySelector('.form-error');
                if (!errEl) {
                    errEl = document.createElement('div');
                    errEl.className = 'form-error';
                    group.appendChild(errEl);
                }
                errEl.textContent = f.message || 'Обязательное поле';
            }
            valid = false;
        }
    });
    if (!valid) {
        const first = document.querySelector('.invalid');
        if (first) first.focus();
    }
    return valid;
}

// ==================== INLINE EDIT (double-click) ====================
function initInlineEdit() {
    document.addEventListener('dblclick', (e) => {
        const el = e.target.closest('[data-editable]');
        if (!el || el.querySelector('input,textarea,select')) return;

        const field = el.dataset.editable;
        const currentValue = el.textContent.trim();
        let input;

        if (field === 'description' || field === 'comment') {
            input = document.createElement('textarea');
            input.style.cssText = 'width:100%;min-height:60px;padding:6px;border:1px solid var(--primary);border-radius:6px;font:inherit;font-size:0.85rem;';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.style.cssText = 'width:100%;padding:4px 8px;border:1px solid var(--primary);border-radius:6px;font:inherit;font-size:0.85rem;';
        }

        input.value = currentValue;
        el.textContent = '';
        el.appendChild(input);
        input.focus();
        input.select();

        async function save() {
            const newVal = input.value.trim() || currentValue;
            el.textContent = newVal;

            const taskEl = el.closest('[data-task-id]');
            const projectEl = el.closest('[data-project-id]');

            try {
                if (taskEl) {
                    const updates = {};
                    updates[field] = newVal;
                    await API.updateTask(taskEl.dataset.taskId, updates);
                } else if (projectEl) {
                    const updates = {};
                    updates[field] = newVal;
                    await API.updateProject(projectEl.dataset.projectId, updates);
                }
            } catch (err) {
                console.error('Inline edit save failed:', err);
            }
        }

        input.addEventListener('blur', save);
        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); input.blur(); }
            if (ev.key === 'Escape') { el.textContent = currentValue; }
        });
    });
}

// ==================== REALTIME UPDATES ====================
// Poll the server change version; when data changed (by anyone), refresh
// badges/notifications and the current page (pages expose window.refreshPageData)
let _rtVersion = null;

async function pollRealtimeChanges() {
    if (!API.isLoggedIn()) return;
    try {
        const resp = await fetch('/api/version', { headers: { 'Authorization': 'Bearer ' + API.token } });
        if (!resp.ok) return;
        const data = await resp.json();
        if (_rtVersion !== null && data.v !== _rtVersion) {
            updateBadges();
            // Don't re-render while the user is editing in a modal or rich editor
            const overlay = document.getElementById('modalOverlay');
            const editing = overlay && overlay.classList.contains('show');
            if (!editing && typeof isAnyRichEditorOpen === 'function' && isAnyRichEditorOpen()) return;
            if (!editing && typeof window.refreshPageData === 'function') window.refreshPageData();
        }
        _rtVersion = data.v;
    } catch (err) {}
}

// Task burger menu — slides action tray to the left
window.toggleTaskMenu = function(btn) {
    const wrap = btn.closest('.task-actions');
    if (!wrap) return;
    const isOpen = wrap.classList.contains('open');
    document.querySelectorAll('.task-actions.open').forEach(el => el.classList.remove('open'));
    if (!isOpen) wrap.classList.add('open');
};

document.addEventListener('click', function(e) {
    if (e.target.closest('.task-menu-tray .task-action-btn')) {
        document.querySelectorAll('.task-actions.open').forEach(el => el.classList.remove('open'));
        return;
    }
    if (!e.target.closest('.task-actions')) {
        document.querySelectorAll('.task-actions.open').forEach(el => el.classList.remove('open'));
    }
});

// ==================== GLOBAL HOTKEYS ====================
const HOTKEY_LS_ENABLED = 'crm_hotkeys_enabled';
const HOTKEY_LS_BLOCK_TYPING = 'crm_hotkeys_block_typing';

function getHotkeysEnabled() {
    const v = localStorage.getItem(HOTKEY_LS_ENABLED);
    return v === null ? true : v === '1';
}
function getHotkeysBlockTyping() {
    const v = localStorage.getItem(HOTKEY_LS_BLOCK_TYPING);
    return v === null ? true : v === '1';
}
function setHotkeysEnabled(on) {
    localStorage.setItem(HOTKEY_LS_ENABLED, on ? '1' : '0');
    updateHotkeysBtnState();
}
function setHotkeysBlockTyping(on) {
    localStorage.setItem(HOTKEY_LS_BLOCK_TYPING, on ? '1' : '0');
}

function updateHotkeysBtnState() {
    const btn = document.getElementById('hotkeysBtn');
    if (!btn) return;
    btn.classList.toggle('hotkeys-off', !getHotkeysEnabled());
    btn.title = getHotkeysEnabled() ? 'Хоткеи' : 'Хоткеи выключены';
}

const CRMKeys = {
    _page: [],
    register(items) {
        this._page = Array.isArray(items) ? items : [];
        renderHotkeysPanel();
    },
    clear() { this._page = []; renderHotkeysPanel(); },
    globals: [
        { keys: 'HOT / Ctrl+/', label: 'Подсказки хоткеев', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '/', always: true },
        { keys: 'Ctrl+K', label: 'Фокус на поиск', match: (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' },
        { keys: 'Ctrl+1', label: 'Дашборд', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '1', go: '/pages/dashboard.html' },
        { keys: 'Ctrl+2', label: 'Проекты', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '2', go: '/pages/projects.html' },
        { keys: 'Ctrl+3', label: 'Задачи', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '3', go: '/pages/tasks.html' },
        { keys: 'Ctrl+4', label: 'Цели', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '4', go: '/pages/goals.html' },
        { keys: 'Ctrl+5', label: 'Календарь', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '5', go: '/pages/calendar.html' },
        { keys: 'Ctrl+6', label: 'Финансы', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '6', go: '/pages/money.html' },
        { keys: 'Ctrl+7', label: 'Настройки', match: (e) => (e.ctrlKey || e.metaKey) && e.key === '7', go: '/pages/settings.html' },
        { keys: 'Ctrl+Z', label: 'Отмена (на странице)', match: (e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey, action: 'undo' },
        { keys: 'Ctrl+Y', label: 'Повтор (на странице)', match: (e) => (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)), action: 'redo' },
        { keys: 'Esc', label: 'Закрыть модалку / меню', match: (e) => e.key === 'Escape' }
    ]
};

function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'textarea' || el.isContentEditable) return true;
    if (tag === 'select') return true;
    if (tag === 'input') {
        const type = (el.type || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'color', 'range', 'hidden'].includes(type)) return false;
        return true;
    }
    return false;
}

/** Text-editing shortcuts that should still work while typing */
function isTextEditingShortcut(e) {
    if (!(e.ctrlKey || e.metaKey)) return false;
    const k = e.key.toLowerCase();
    return ['a', 'c', 'v', 'x', 'z', 'y', 'b', 'i', 'u'].includes(k) || (k === 'z' && e.shiftKey);
}

function renderHotkeysSettings() {
    const box = document.getElementById('hotkeysSettings');
    if (!box) return;
    const enabled = getHotkeysEnabled();
    const blockTyping = getHotkeysBlockTyping();
    box.innerHTML = `
        <label class="hotkeys-switch">
            <span>Все хоткеи</span>
            <input type="checkbox" id="hkEnabled" ${enabled ? 'checked' : ''}>
            <span class="hotkeys-switch-ui" aria-hidden="true"></span>
        </label>
        <label class="hotkeys-switch">
            <span>Выкл. при вводе текста</span>
            <input type="checkbox" id="hkBlockTyping" ${blockTyping ? 'checked' : ''}>
            <span class="hotkeys-switch-ui" aria-hidden="true"></span>
        </label>
    `;
    const en = document.getElementById('hkEnabled');
    const bt = document.getElementById('hkBlockTyping');
    if (en) en.addEventListener('change', () => {
        setHotkeysEnabled(en.checked);
        if (bt) bt.disabled = !en.checked;
    });
    if (bt) {
        bt.disabled = !enabled;
        bt.addEventListener('change', () => setHotkeysBlockTyping(bt.checked));
    }
}

function renderHotkeysList() {
    const list = document.getElementById('hotkeysList');
    if (!list) return;
    const rows = [
        ...CRMKeys.globals.map(h => ({ keys: h.keys, label: h.label })),
        ...CRMKeys._page.map(h => ({ keys: h.keys, label: h.label }))
    ];
    list.innerHTML = rows.map(r => {
        const keysHtml = String(r.keys).split(/\s*\/\s*/).map(combo =>
            combo.split('+').map(k => '<kbd>' + k.trim() + '</kbd>').join('<span class="hotkeys-plus">+</span>')
        ).join(' <span class="hotkeys-plus">/</span> ');
        return `
        <div class="hotkeys-item">
            <span class="hotkeys-keys">${keysHtml}</span>
            <span class="hotkeys-label">${r.label}</span>
        </div>`;
    }).join('');
}

function renderHotkeysPanel() {
    renderHotkeysSettings();
    renderHotkeysList();
    updateHotkeysBtnState();
}

function toggleHotkeysPanel() {
    const dd = document.getElementById('hotkeysDropdown');
    const btn = document.getElementById('hotkeysBtn');
    if (!dd) return;
    const open = dd.classList.contains('show');
    document.querySelectorAll('.notif-dropdown.show, .user-dropdown.show').forEach(d => d.classList.remove('show'));
    if (open) {
        dd.classList.remove('show');
        if (btn) btn.setAttribute('aria-expanded', 'false');
    } else {
        renderHotkeysPanel();
        dd.classList.add('show');
        if (btn) btn.setAttribute('aria-expanded', 'true');
    }
}

function initGlobalHotkeys() {
    if (window._globalHotkeysInit) return;
    window._globalHotkeysInit = true;
    updateHotkeysBtnState();

    document.addEventListener('keydown', (e) => {
        const typing = isTypingTarget(document.activeElement);

        // Always allow opening the HOT panel
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            toggleHotkeysPanel();
            return;
        }

        if (!getHotkeysEnabled()) return;

        // While typing: keep browser/text shortcuts, block CRM action hotkeys
        if (typing && getHotkeysBlockTyping()) {
            if (isTextEditingShortcut(e)) return;
            // Block page letter hotkeys (N, S, P…) and CRM navigation while typing
            for (const h of CRMKeys._page) {
                if (h.allowInInput && h.match && h.match(e)) {
                    e.preventDefault();
                    if (typeof h.run === 'function') h.run(e);
                    return;
                }
            }
            return;
        }

        // Page-specific
        for (const h of CRMKeys._page) {
            if (h.allowInInput || !typing) {
                if (h.match && h.match(e)) {
                    e.preventDefault();
                    if (typeof h.run === 'function') h.run(e);
                    return;
                }
            }
        }

        if (typing) return;

        for (const h of CRMKeys.globals) {
            if (!h.match || !h.match(e)) continue;
            if (h.keys === 'Esc' || h.always) continue;
            if (h.go) { e.preventDefault(); window.location.href = h.go; return; }
            if (h.action === 'undo' && typeof window.pageUndo === 'function') { e.preventDefault(); window.pageUndo(); return; }
            if (h.action === 'redo' && typeof window.pageRedo === 'function') { e.preventDefault(); window.pageRedo(); return; }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                const search = document.querySelector('.search-input');
                if (search) search.focus();
                return;
            }
        }
    });
}

// ==================== RICH TEXT EDITOR ====================
function escapeHtmlAttr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Normalize checklist items to Jira-like action items (no <input> in contenteditable) */
function normalizeChecklistHtml(root) {
    root.querySelectorAll('ul.rich-checklist, ul').forEach(ul => {
        const looksLikeCheck = ul.classList.contains('rich-checklist') ||
            ul.querySelector('input[type="checkbox"], .rich-check, li[data-checked]');
        if (!looksLikeCheck) return;
        ul.classList.add('rich-checklist');
        [...ul.children].forEach(li => {
            if (li.tagName !== 'LI') return;
            li.classList.add('rich-check-item');
            let checked = li.getAttribute('data-checked') === 'true';
            const oldInput = li.querySelector('input[type="checkbox"]');
            if (oldInput) {
                checked = oldInput.checked || oldInput.hasAttribute('checked');
                oldInput.remove();
            }
            li.setAttribute('data-checked', checked ? 'true' : 'false');
            let box = li.querySelector('.rich-check');
            if (!box) {
                box = document.createElement('span');
                box.className = 'rich-check';
                box.setAttribute('contenteditable', 'false');
                li.insertBefore(box, li.firstChild);
            } else {
                box.setAttribute('contenteditable', 'false');
            }
            // Wrap leftover text into label span if needed
            let label = li.querySelector('.rich-check-label');
            if (!label) {
                label = document.createElement('span');
                label.className = 'rich-check-label';
                const nodes = [...li.childNodes].filter(n => n !== box);
                nodes.forEach(n => label.appendChild(n));
                if (!label.textContent.trim()) label.innerHTML = '<br>';
                li.appendChild(label);
            }
            if (checked) li.classList.add('is-checked');
            else li.classList.remove('is-checked');
        });
    });
}

function guessFileKind(name, mime) {
    const m = String(mime || '').toLowerCase();
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (m.startsWith('image/') || ['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext)) return 'image';
    if (m.startsWith('video/') || ['mp4','webm','ogg','mov','m4v'].includes(ext)) return 'video';
    if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (m.startsWith('text/') || ['txt','md','csv','json','log','xml','html','css','js'].includes(ext)) return 'text';
    return 'file';
}

/** Add auth token for /uploads so <img>/<iframe> can load files */
function authedUploadUrl(url) {
    const u = String(url || '');
    if (!u.startsWith('/uploads/')) return u;
    const token = (typeof API !== 'undefined' && API.token) || localStorage.getItem('crm_token') || '';
    if (!token) return u;
    const base = u.split('?')[0];
    return base + '?token=' + encodeURIComponent(token);
}

/**
 * Inline file/media in the editor — one selectable unit (Ctrl+C / Delete / Backspace).
 * mode=link → chip link; mode=embed → image/video/pdf preview.
 */
function buildRichAttachHtml({ url, name, mime, mode = 'link' }) {
    const rawUrl = String(url || '').split('?')[0].replace(/"/g, '');
    const safeUrl = authedUploadUrl(rawUrl);
    const safeName = escapeHtmlText(name || 'Файл');
    const safeMime = escapeHtmlText(mime || '');
    const kind = guessFileKind(name, mime);
    const viewUrl = '/pages/file-viewer.html?src=' + encodeURIComponent(rawUrl) +
        '&name=' + encodeURIComponent(name || 'Файл') +
        '&kind=' + encodeURIComponent(kind);
    const modeVal = mode === 'embed' ? 'embed' : 'link';

    let inner = '';
    if (modeVal === 'embed' && kind === 'image') {
        inner = `<img class="rich-attach-media" src="${safeUrl}" alt="${safeName}" data-view="${viewUrl}">`;
    } else if (modeVal === 'embed' && kind === 'video') {
        inner = `<video class="rich-attach-media" src="${safeUrl}" controls preload="metadata" data-view="${viewUrl}"></video>`;
    } else if (modeVal === 'embed' && kind === 'pdf') {
        inner = `<span class="rich-attach-pdf" data-view="${viewUrl}" title="Открыть PDF">📄 ${safeName}</span>`;
    } else {
        inner = `<a class="rich-attach-link" href="${safeUrl}" download="${safeName}" data-view="${viewUrl}">📎 ${safeName}</a>`;
    }

    return `<span class="rich-attach" contenteditable="false" data-file="${rawUrl}" data-name="${safeName}" data-mime="${safeMime}" data-kind="${kind}" data-mode="${modeVal}" data-view="${viewUrl}">${inner}<span class="rich-attach-mode" data-set-mode="${modeVal === 'embed' ? 'link' : 'embed'}" title="Переключить вид">${modeVal === 'embed' ? '🔗' : '👁'}</span></span>`;
}

function sanitizeRichHtml(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    // Strip dangerous nodes; checkboxes use span.rich-check (Jira-style), not <input>
    // Keep iframes only inside .rich-attach (PDF preview)
    div.querySelectorAll('script,object,embed,link,style,textarea,select,button,form').forEach(n => n.remove());
    div.querySelectorAll('iframe').forEach(n => {
        if (!n.closest('.rich-attach')) n.remove();
    });
    div.querySelectorAll('input').forEach(n => {
        // Convert legacy checkbox inputs before remove
        if ((n.type || '').toLowerCase() === 'checkbox') {
            const li = n.closest('li');
            if (li) {
                const checked = n.checked || n.hasAttribute('checked');
                li.setAttribute('data-checked', checked ? 'true' : 'false');
                li.classList.add('rich-check-item');
                const ul = li.closest('ul');
                if (ul) ul.classList.add('rich-checklist');
            }
        }
        n.remove();
    });
    normalizeChecklistHtml(div);
    div.querySelectorAll('*').forEach(el => {
        [...el.attributes].forEach(a => {
            if (/^on/i.test(a.name) || ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value))) {
                el.removeAttribute(a.name);
            }
        });
        if (el.tagName === 'A') el.setAttribute('draggable', 'false');
        // Keep contenteditable=false on check boxes / attachments
        if (el.classList && (el.classList.contains('rich-check') || el.classList.contains('rich-attach'))) {
            el.setAttribute('contenteditable', 'false');
        }
    });
    // Rebuild attach blocks from data attrs (keeps modes consistent after sanitize)
    div.querySelectorAll('.rich-attach').forEach(block => {
        const url = block.getAttribute('data-file') || '';
        const name = block.getAttribute('data-name') || 'Файл';
        const mime = block.getAttribute('data-mime') || '';
        const mode = block.getAttribute('data-mode') || 'link';
        if (!url) { block.remove(); return; }
        const tmp = document.createElement('div');
        tmp.innerHTML = buildRichAttachHtml({ url, name, mime, mode });
        const next = tmp.querySelector('.rich-attach');
        if (next) block.replaceWith(next);
    });
    return div.innerHTML;
}

function makeChecklistItemHtml(text = '', checked = false) {
    const label = text ? escapeHtmlText(text) : '<br>';
    return `<li class="rich-check-item${checked ? ' is-checked' : ''}" data-checked="${checked ? 'true' : 'false'}"><span class="rich-check" contenteditable="false"></span><span class="rich-check-label">${label}</span></li>`;
}

function escapeHtmlText(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function plainOrHtmlToRich(text) {
    if (!text) return '';
    if (/<[a-z][\s\S]*>/i.test(text)) return sanitizeRichHtml(text);
    return String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
}

function renderRichHtml(text) {
    if (!text) return '';
    return plainOrHtmlToRich(text);
}

function stripHtmlText(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
}

/** YYYY-MM-DD[THH:mm] (+ optional legacy time) → value for datetime-local */
function toDatetimeLocalValue(dateStr, legacyTime) {
    if (!dateStr) return '';
    const s = String(dateStr).trim();
    if (s.includes('T')) return s.slice(0, 16);
    if (/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s)) return s.replace(' ', 'T').slice(0, 16);
    const day = s.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
    const t = (legacyTime || '00:00').toString().slice(0, 5);
    return day + 'T' + ( /^\d{2}:\d{2}$/.test(t) ? t : '00:00' );
}

function todayDatetimeLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function datePart(value) {
    if (!value) return '';
    return String(value).trim().slice(0, 10);
}

/** Display: 31.07.2026 14:00 */
function formatTaskDateTime(value, legacyTime) {
    const local = toDatetimeLocalValue(value, legacyTime);
    if (!local) return '';
    const [day, time] = local.split('T');
    const p = day.split('-');
    if (p.length !== 3) return local;
    const nice = `${p[2]}.${p[1]}.${p[0]}`;
    if (!time || time === '00:00') return nice;
    return nice + ' ' + time.slice(0, 5);
}

function formatTaskDateRange(t) {
    const a = formatTaskDateTime(t.date, t.time);
    const b = formatTaskDateTime(t.date_end, !t.date ? t.time : '');
    if (a && b && a !== b) return a + ' — ' + b;
    return a || b || '';
}

const PRIORITY_DOT = { low: '#10B981', medium: '#F59E0B', high: '#EF4444' };
const PRIORITY_LABEL = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };

function renderPriorityMark(priority) {
    const p = priority || 'medium';
    const label = PRIORITY_LABEL[p] || 'Средний';
    const tip = 'Приоритет: ' + label;
    return `<span class="prio-mark tip" data-tip="${tip}" title="${tip}" aria-label="${tip}" style="background:${PRIORITY_DOT[p] || PRIORITY_DOT.medium};"></span>`;
}

/** In card previews force attachments to compact file-type chips (no full embed). */
function forceAttachPreviewChips(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('.rich-attach').forEach(block => {
        block.setAttribute('data-mode', 'link');
        const name = block.getAttribute('data-name') || 'Файл';
        const mime = block.getAttribute('data-mime') || '';
        const kind = block.getAttribute('data-kind') || guessFileKind(name, mime);
        const ext = (String(name).split('.').pop() || kind || 'file').toUpperCase().slice(0, 6);
        const tip = (kind || 'file') + (name ? ': ' + name : '');
        block.setAttribute('title', tip);
        block.setAttribute('data-tip', tip);
        block.classList.add('tip', 'rich-attach-chip');
        // Replace heavy media with type badge
        const link = block.querySelector('.rich-attach-link');
        if (link) {
            link.textContent = ext;
            link.title = tip;
        } else {
            block.innerHTML = `<a class="rich-attach-link" href="${block.getAttribute('data-file') || '#'}" target="_blank" rel="noopener" draggable="false" title="${escapeHtmlText(tip)}">${escapeHtmlText(ext)}</a>`;
        }
        const modeBtn = block.querySelector('.rich-attach-mode');
        if (modeBtn) modeBtn.remove();
    });
    return div.innerHTML;
}

/**
 * Compact rich description preview for cards (headings/lists kept).
 * Interactive nodes are inert; chevron toggles expand. DnD-safe via CSS.
 */
function renderDescClamp(html, { lines = 3, id, compactFiles = true } = {}) {
    const prepared = compactFiles ? forceAttachPreviewChips(html) : html;
    const text = stripHtmlText(prepared);
    if (!text && !(prepared && prepared.includes('rich-attach'))) return '';
    const cid = id || ('dc_' + Math.random().toString(36).slice(2, 9));
    const long = text.length > 90 || /<(h[1-6]|ul|ol|li|br|p)\b/i.test(prepared || '');
    const rich = renderRichHtml(prepared);
    return `<div class="desc-clamp-wrap${long ? '' : ' desc-short'}" data-desc-clamp="${cid}">
        <div class="desc-clamp-row">
            <div class="desc-clamp rich-content" id="${cid}" style="--desc-lines:${lines}">${rich}</div>
            ${long ? `<button type="button" class="desc-clamp-btn tip" data-tip="Развернуть описание" onclick="event.preventDefault();event.stopPropagation();toggleDescClamp(this);return false;" title="Развернуть" aria-label="Развернуть описание">
                <svg class="chev-down" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>
                <svg class="chev-up" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18,15 12,9 6,15"/></svg>
            </button>` : ''}
        </div>
    </div>`;
}

/** Progress 0–100 by time between start and end (moves toward deadline). */
function goalTimeProgress(dateStart, dateEnd, status) {
    if (status === 'done') return 100;
    if (!dateEnd) return 0;
    const end = new Date(String(dateEnd).slice(0, 10) + 'T23:59:59').getTime();
    if (Number.isNaN(end)) return 0;
    let start;
    if (dateStart) {
        start = new Date(String(dateStart).slice(0, 10) + 'T00:00:00').getTime();
    } else {
        start = end - 30 * 86400000;
    }
    if (Number.isNaN(start) || end <= start) return 0;
    const now = Date.now();
    if (now <= start) return 0;
    if (now >= end) return 100;
    return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
}
window.goalTimeProgress = goalTimeProgress;

window.toggleDescClamp = function(btn, ev) {
    if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
    }
    const wrap = btn && btn.closest ? btn.closest('.desc-clamp-wrap') : null;
    if (!wrap) return;
    wrap.classList.toggle('expanded');
    const open = wrap.classList.contains('expanded');
    btn.title = open ? 'Свернуть' : 'Развернуть';
    btn.setAttribute('aria-label', open ? 'Свернуть описание' : 'Развернуть описание');
    return false;
};

/**
 * opts.fullPreview — show full description when collapsed (no clamp),
 *   but editor still opens on click and closes on outside click.
 */
function renderRichEditor(id, value = '', placeholder = 'Текст…', opts = {}) {
    const fullPreview = !!(opts && (opts.fullPreview || opts.alwaysOpen));
    const body = plainOrHtmlToRich(value);
    const empty = !stripHtmlText(value);
    return `
    <div class="rich-editor rich-collapsed${fullPreview ? ' rich-full-preview' : ''}" data-rich-wrap="${id}" data-placeholder="${escapeHtmlAttr(placeholder)}"${fullPreview ? ' data-full-preview="1"' : ''}>
        <div class="rich-toolbar" data-rich-toolbar="${id}">
            <button type="button" data-cmd="bold" title="Жирный (Ctrl+B)"><b>B</b></button>
            <button type="button" data-cmd="italic" title="Курсив (Ctrl+I)"><i>I</i></button>
            <button type="button" data-cmd="underline" title="Подчёркнутый (Ctrl+U)"><u>U</u></button>
            <button type="button" data-cmd="strikeThrough" title="Зачёркнутый"><s>S</s></button>
            <span class="rich-sep"></span>
            <button type="button" data-cmd="formatBlock" data-val="h2" title="Заголовок">H2</button>
            <button type="button" data-cmd="formatBlock" data-val="h3" title="Подзаголовок">H3</button>
            <button type="button" data-cmd="formatBlock" data-val="p" title="Обычный текст">¶</button>
            <span class="rich-sep"></span>
            <button type="button" data-cmd="insertUnorderedList" title="Маркированный список">•</button>
            <button type="button" data-cmd="insertOrderedList" title="Нумерованный список">1.</button>
            <button type="button" data-cmd="checklist" title="Чеклист (как в Jira)">☑</button>
            <span class="rich-sep"></span>
            <button type="button" data-cmd="justifyLeft" title="По левому краю">⇤</button>
            <button type="button" data-cmd="justifyCenter" title="По центру">≡</button>
            <button type="button" data-cmd="createLink" title="Ссылка">URL</button>
            <button type="button" data-cmd="attach" title="Прикрепить файл">📎</button>
            <button type="button" data-cmd="removeFormat" title="Очистить формат">Tx</button>
            <button type="button" class="rich-done-btn" data-cmd="done" title="Готово">Готово</button>
        </div>
        <input type="file" class="rich-attach-input" data-rich-file="${id}" hidden accept="*/*">
        <div class="rich-body${empty ? ' rich-empty' : ''}" id="${id}" contenteditable="false" data-placeholder="${escapeHtmlAttr(placeholder)}" role="textbox">${empty ? '' : body}</div>
    </div>`;
}

function getRichEditorValue(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.classList.contains('rich-empty')) return '';
    const html = el.innerHTML.trim();
    if (html === '<br>' || html === '<div><br></div>') return '';
    return sanitizeRichHtml(html);
}

/** Read description from rich editor or fallback textarea/input */
function getDescValue(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    if (el.classList.contains('rich-body')) return getRichEditorValue(id);
    return (el.value || '').trim();
}

function bindRichEditor(id, { onBlur, onChange } = {}) {
    const wrap = document.querySelector(`[data-rich-wrap="${id}"]`);
    const body = document.getElementById(id);
    if (!wrap || !body || wrap.dataset.richBound === '1') return;
    wrap.dataset.richBound = '1';

    function isOpen() {
        return !wrap.classList.contains('rich-collapsed');
    }

    function emitChange() {
        const html = getRichEditorValue(id);
        if (typeof onChange === 'function') onChange(html);
    }

    function openEditor() {
        if (isOpen() && body.contentEditable === 'true') return;
        wrap.classList.remove('rich-collapsed');
        wrap.dataset.richOpen = '1';
        if (body.classList.contains('rich-empty')) {
            body.classList.remove('rich-empty');
            body.innerHTML = '';
        } else if (body.innerHTML) {
            // Normalize any legacy checkboxes
            body.innerHTML = sanitizeRichHtml(body.innerHTML);
        }
        body.contentEditable = 'true';
        body.focus();
    }

    function closeEditor(save) {
        if (!isOpen()) return;
        const html = getRichEditorValue(id);
        body.contentEditable = 'false';
        wrap.classList.add('rich-collapsed');
        delete wrap.dataset.richOpen;
        if (!stripHtmlText(html)) {
            body.innerHTML = '';
            body.classList.add('rich-empty');
        } else {
            body.classList.remove('rich-empty');
            body.innerHTML = sanitizeRichHtml(html);
        }
        if (save && typeof onBlur === 'function') onBlur(html);
    }

    function findChecklistNearCaret() {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
            let n = sel.anchorNode;
            if (n && n.nodeType === 3) n = n.parentElement;
            const existing = n && n.closest ? n.closest('ul.rich-checklist') : null;
            if (existing && body.contains(existing)) return existing;
        }
        return body.querySelector('ul.rich-checklist');
    }

    function insertChecklist() {
        body.classList.remove('rich-empty');
        const existing = findChecklistNearCaret();
        if (existing) {
            const li = document.createElement('li');
            li.className = 'rich-check-item';
            li.setAttribute('data-checked', 'false');
            li.innerHTML = '<span class="rich-check" contenteditable="false"></span><span class="rich-check-label"><br></span>';
            existing.appendChild(li);
            placeCaretInLabel(li.querySelector('.rich-check-label'));
        } else {
            document.execCommand('insertHTML', false,
                '<ul class="rich-checklist">' + makeChecklistItemHtml('') + '</ul>');
        }
        emitChange();
    }

    function placeCaretInLabel(label) {
        if (!label) return;
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(label);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    function toggleCheckItem(li) {
        if (!li) return;
        const on = li.getAttribute('data-checked') === 'true';
        li.setAttribute('data-checked', on ? 'false' : 'true');
        li.classList.toggle('is-checked', !on);
        emitChange();
        // onChange already notifies; no-op here
    }

    wrap.querySelectorAll('[data-cmd]').forEach(btn => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isOpen()) openEditor();
            const cmd = btn.dataset.cmd;
            if (cmd === 'done') {
                closeEditor(true);
                return;
            }
            body.focus();
            if (cmd === 'checklist') {
                insertChecklist();
                return;
            }
            if (cmd === 'createLink') {
                const url = prompt('Ссылка (https://…)', 'https://');
                if (url) document.execCommand('createLink', false, url);
                body.focus();
                emitChange();
                return;
            }
            if (cmd === 'attach') {
                const input = wrap.querySelector('.rich-attach-input');
                if (input) input.click();
                return;
            }
            if (cmd === 'formatBlock') {
                document.execCommand('formatBlock', false, btn.dataset.val || 'h3');
                emitChange();
                return;
            }
            document.execCommand(cmd, false, btn.dataset.val || null);
            emitChange();
        });
    });

    async function uploadAndInsertFile(file) {
        if (!file) return;
        const maxBytes = 30 * 1024 * 1024;
        if (file.size > maxBytes) {
            throw new Error('«' + file.name + '»: больше 30 МБ (' + Math.round(file.size / 1024 / 1024) + ' МБ)');
        }
        if (!isOpen()) openEditor();
        const fd = new FormData();
        fd.append('file', file);
        let uploaded;
        try {
            uploaded = await API.uploadFile(fd);
        } catch (e1) {
            // Fallback
            try {
                const fd2 = new FormData();
                fd2.append('file', file);
                fd2.append('title', file.name);
                fd2.append('kind', 'file');
                const page = await API.uploadWikiPage(fd2);
                if (!page || !page.file_path) throw e1;
                uploaded = {
                    url: '/uploads/' + page.file_path,
                    originalname: page.title || file.name,
                    mimetype: file.type || '',
                    size: file.size
                };
            } catch (e2) {
                throw new Error(e1.message || e2.message || 'Ошибка загрузки');
            }
        }
        if (!uploaded || !uploaded.url) throw new Error('Сервер не вернул URL файла');
        const html = buildRichAttachHtml({
            url: uploaded.url,
            name: uploaded.originalname || file.name,
            mime: uploaded.mimetype || file.type || '',
            mode: guessFileKind(file.name, file.type) === 'image' ? 'embed' : 'link'
        });
        body.classList.remove('rich-empty');
        body.focus();
        const chunk = '\u200B' + html + '\u200B';
        let inserted = false;
        try {
            inserted = document.execCommand('insertHTML', false, chunk);
        } catch (e) { inserted = false; }
        if (!inserted) {
            const tmp = document.createElement('div');
            tmp.innerHTML = chunk;
            while (tmp.firstChild) body.appendChild(tmp.firstChild);
        }
        body.innerHTML = sanitizeRichHtml(body.innerHTML);
        emitChange();
        return uploaded;
    }

    // Expose for page-level file strip
    wrap._uploadAndInsertFile = uploadAndInsertFile;

    const fileInput = wrap.querySelector('.rich-attach-input');
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            fileInput.value = '';
            if (!file) return;
            if (typeof showToast === 'function') showToast('Загрузка: ' + file.name + '…', 'info');
            try {
                await uploadAndInsertFile(file);
                if (typeof showToast === 'function') showToast('Файл прикреплён: ' + file.name, 'success');
            } catch (err) {
                console.error('Attach upload failed', err);
                if (typeof showToast === 'function') showToast(err.message || 'Ошибка загрузки', 'error');
            }
        });
    }

    // Drag & drop files from explorer into editor
    function isFileDrag(e) {
        const dt = e.dataTransfer;
        if (!dt) return false;
        const types = dt.types ? [...dt.types] : [];
        return types.includes('Files') || (dt.files && dt.files.length > 0);
    }
    async function handleFileDrop(e) {
        if (!isFileDrag(e)) return false;
        e.preventDefault();
        e.stopPropagation();
        wrap.classList.remove('rich-drop-active');
        const files = [...(e.dataTransfer.files || [])];
        if (!files.length) return true;
        for (const file of files) {
            try {
                if (typeof showToast === 'function') showToast('Загрузка: ' + file.name + '…', 'info');
                await uploadAndInsertFile(file);
                if (typeof showToast === 'function') showToast('Файл прикреплён: ' + file.name, 'success');
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message || 'Ошибка загрузки', 'error');
            }
        }
        return true;
    }
    const fileDropOpts = { capture: true };
    ['dragenter', 'dragover'].forEach(evName => {
        wrap.addEventListener(evName, (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.stopPropagation();
            try { e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
            wrap.classList.add('rich-drop-active');
            if (!isOpen()) openEditor();
        }, fileDropOpts);
    });
    wrap.addEventListener('dragleave', (e) => {
        if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('rich-drop-active');
    }, fileDropOpts);
    wrap.addEventListener('drop', (e) => { handleFileDrop(e); }, fileDropOpts);

    function openAttachViewer(el) {
        const node = el.closest('[data-view]') || el.closest('.rich-attach');
        const view = node && (node.getAttribute('data-view') || '');
        if (view) {
            window.open(view, '_blank', 'noopener');
            return true;
        }
        return false;
    }

    function setAttachMode(block, mode) {
        if (!block) return;
        const url = block.getAttribute('data-file');
        const name = block.getAttribute('data-name') || 'Файл';
        const mime = block.getAttribute('data-mime') || '';
        const tmp = document.createElement('div');
        tmp.innerHTML = buildRichAttachHtml({ url, name, mime, mode });
        const next = tmp.querySelector('.rich-attach');
        if (next) {
            block.replaceWith(next);
            emitChange();
        }
    }

    function selectAttachNode(attach) {
        if (!attach) return;
        const range = document.createRange();
        range.selectNode(attach);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }

    body.addEventListener('click', (e) => {
        const attach = e.target && e.target.closest ? e.target.closest('.rich-attach') : null;
        if (attach && body.contains(attach)) {
            if (!isOpen()) openEditor();
            const modeBtn = e.target.closest('.rich-attach-mode');
            if (modeBtn) {
                e.preventDefault();
                e.stopPropagation();
                setAttachMode(attach, modeBtn.getAttribute('data-set-mode') || 'link');
                return;
            }
            // Double-click / Alt+click → open fullscreen viewer
            if (e.detail >= 2 || e.altKey) {
                e.preventDefault();
                openAttachViewer(attach);
                return;
            }
            // Single click → select whole file (for copy/delete)
            e.preventDefault();
            e.stopPropagation();
            selectAttachNode(attach);
            return;
        }
        const check = e.target && e.target.closest ? e.target.closest('.rich-check') : null;
        if (check && body.contains(check)) {
            e.preventDefault();
            e.stopPropagation();
            if (!isOpen()) openEditor();
            toggleCheckItem(check.closest('li.rich-check-item'));
            return;
        }
        if (!isOpen()) {
            e.preventDefault();
            openEditor();
        }
    });

    wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!isOpen() && !e.target.closest('.rich-toolbar')) {
            openEditor();
        }
    });

    // Copy selected attach as HTML + plain name/URL (Ctrl+C)
    body.addEventListener('copy', (e) => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) return;
        const range = sel.getRangeAt(0);
        let attach = null;
        if (range.startContainer === range.endContainer &&
            range.startContainer.nodeType === 1 &&
            range.startContainer.classList?.contains('rich-attach')) {
            attach = range.startContainer;
        } else {
            const el = range.commonAncestorContainer.nodeType === 1
                ? range.commonAncestorContainer
                : range.commonAncestorContainer.parentElement;
            attach = el && el.closest ? el.closest('.rich-attach') : null;
            if (!attach) {
                const frag = range.cloneContents();
                attach = frag.querySelector && frag.querySelector('.rich-attach');
                // Prefer live node in editor if selected via selectNodeContents-ish
                if (attach) {
                    const url = attach.getAttribute('data-file');
                    attach = url ? body.querySelector('.rich-attach[data-file="' + CSS.escape(url) + '"]') || attach : attach;
                }
            }
        }
        if (!attach) return;
        const url = attach.getAttribute('data-file') || '';
        const name = attach.getAttribute('data-name') || 'Файл';
        const html = attach.outerHTML || '';
        e.clipboardData.setData('text/plain', name + (url ? '\n' + url : ''));
        if (html) e.clipboardData.setData('text/html', html);
        e.preventDefault();
    });

    // Keyboard: delete/copy selected attach; checklist Enter; Backspace near attach
    body.addEventListener('keydown', (e) => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;

        // If selection is (or contains) a rich-attach — Delete/Backspace removes it
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const range = sel.getRangeAt(0);
            let attach = null;
            if (!sel.isCollapsed) {
                const container = range.commonAncestorContainer;
                const el = container.nodeType === 1 ? container : container.parentElement;
                attach = el && el.closest ? el.closest('.rich-attach') : null;
                if (!attach && el) attach = el.querySelector && range.cloneContents().querySelector('.rich-attach');
                // Also: selected node is the attach itself
                if (!attach && range.startContainer === range.endContainer) {
                    const n = range.startContainer;
                    if (n.nodeType === 1 && n.classList && n.classList.contains('rich-attach')) attach = n;
                    if (n.childNodes && n.childNodes[range.startOffset] &&
                        n.childNodes[range.startOffset].classList &&
                        n.childNodes[range.startOffset].classList.contains('rich-attach')) {
                        attach = n.childNodes[range.startOffset];
                    }
                }
            } else {
                // Collapsed caret: Backspace removes attach before caret; Delete removes after
                const node = sel.anchorNode;
                const offset = sel.anchorOffset;
                if (e.key === 'Backspace') {
                    if (node.nodeType === 3 && offset === 0) {
                        let prev = node.previousSibling;
                        if (!prev && node.parentElement) prev = node.parentElement.previousSibling;
                        if (prev && prev.classList && prev.classList.contains('rich-attach')) attach = prev;
                    } else if (node.nodeType === 1 && offset > 0) {
                        const prev = node.childNodes[offset - 1];
                        if (prev && prev.classList && prev.classList.contains('rich-attach')) attach = prev;
                    }
                } else if (e.key === 'Delete') {
                    if (node.nodeType === 3 && offset === (node.textContent || '').length) {
                        let next = node.nextSibling;
                        if (!next && node.parentElement) next = node.parentElement.nextSibling;
                        if (next && next.classList && next.classList.contains('rich-attach')) attach = next;
                    } else if (node.nodeType === 1) {
                        const next = node.childNodes[offset];
                        if (next && next.classList && next.classList.contains('rich-attach')) attach = next;
                    }
                }
            }
            if (attach && body.contains(attach)) {
                e.preventDefault();
                attach.remove();
                emitChange();
                return;
            }
        }

        let n = sel.anchorNode;
        if (n && n.nodeType === 3) n = n.parentElement;
        const li = n && n.closest ? n.closest('li.rich-check-item') : null;
        if (!li || !body.contains(li)) return;
        const label = li.querySelector('.rich-check-label');
        if (e.key === 'Enter') {
            e.preventDefault();
            const next = document.createElement('li');
            next.className = 'rich-check-item';
            next.setAttribute('data-checked', 'false');
            next.innerHTML = '<span class="rich-check" contenteditable="false"></span><span class="rich-check-label"><br></span>';
            li.after(next);
            placeCaretInLabel(next.querySelector('.rich-check-label'));
            emitChange();
            return;
        }
        if (e.key === 'Backspace' && label && !(label.textContent || '').trim()) {
            e.preventDefault();
            const prev = li.previousElementSibling;
            const ul = li.parentElement;
            li.remove();
            if (ul && !ul.querySelector('li')) ul.remove();
            if (prev) placeCaretInLabel(prev.querySelector('.rich-check-label'));
            emitChange();
        }
    });

    body.addEventListener('focus', () => {
        if (body.classList.contains('rich-empty')) {
            body.classList.remove('rich-empty');
            body.innerHTML = '';
        }
    });

    body.addEventListener('input', () => {
        body.classList.remove('rich-empty');
        emitChange();
    });

    // Close on outside click — skip modal action buttons
    const onDocPointer = (e) => {
        if (!isOpen()) return;
        if (wrap.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.modal-footer, .modal-close, .btn-primary, .btn-secondary, .btn-danger')) return;
        closeEditor(true);
    };
    document.addEventListener('mousedown', onDocPointer, true);
    wrap._richOutsideClose = onDocPointer;
}

// ==================== DRAFT AUTOSAVE (create forms) ====================
window.DraftStore = {
    _key(name) { return 'crm_draft_' + name; },
    save(name, data) {
        try {
            localStorage.setItem(this._key(name), JSON.stringify({ t: Date.now(), data }));
        } catch (e) {}
    },
    load(name) {
        try {
            const raw = localStorage.getItem(this._key(name));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && parsed.data != null ? parsed.data : null;
        } catch (e) { return null; }
    },
    clear(name) {
        try { localStorage.removeItem(this._key(name)); } catch (e) {}
    },
    /** Bind autosave on a modal form. collect() → object, apply(data) fills fields. */
    bind(name, collect, apply) {
        const draft = this.load(name);
        if (draft && typeof apply === 'function') {
            try { apply(draft); } catch (e) {}
        }
        const save = () => {
            try { this.save(name, collect()); } catch (e) {}
        };
        const overlay = document.getElementById('modalOverlay');
        if (!overlay) return save;
        const modal = overlay.querySelector('.modal');
        if (modal) modal.setAttribute('data-draft-key', name);
        const onAny = () => {
            if (!overlay.classList.contains('show')) return;
            save();
        };
        overlay.addEventListener('input', onAny);
        overlay.addEventListener('change', onAny);
        if (overlay._draftTimer) clearInterval(overlay._draftTimer);
        const timer = setInterval(() => {
            if (!overlay.classList.contains('show')) {
                clearInterval(timer);
                overlay.removeEventListener('input', onAny);
                overlay.removeEventListener('change', onAny);
                if (overlay._draftTimer === timer) overlay._draftTimer = null;
                return;
            }
            save();
        }, 1500);
        overlay._draftTimer = timer;
        return save;
    }
};

/** True if any rich editor is currently open (expanded) */
function isAnyRichEditorOpen() {
    return !!document.querySelector('.rich-editor[data-rich-open="1"]');
}

/** Collapse open editors (keeps HTML via getDescValue-compatible state) */
function flushAllRichEditors() {
    document.querySelectorAll('.rich-editor[data-rich-open="1"]').forEach(wrap => {
        const id = wrap.getAttribute('data-rich-wrap');
        if (!id) return;
        const body = document.getElementById(id);
        if (!body) return;
        const html = getRichEditorValue(id);
        body.contentEditable = 'false';
        wrap.classList.add('rich-collapsed');
        delete wrap.dataset.richOpen;
        if (!stripHtmlText(html)) {
            body.innerHTML = '';
            body.classList.add('rich-empty');
        } else {
            body.classList.remove('rich-empty');
            body.innerHTML = sanitizeRichHtml(html);
        }
    });
}

/** Meta line for note reminder cards: created_at + author if not me */
window.formatNoteReminderMeta = function(r) {
    const me = (API.getCurrentUser && API.getCurrentUser())?.name || '';
    let when = '';
    if (r && r.created_at) {
        when = window.CrmTime ? CrmTime.formatDateTime(r.created_at) : String(r.created_at).slice(0, 16);
    }
    const by = (r && r.created_by) ? String(r.created_by).trim() : '';
    if (by && me && by !== me) return (when ? when + ' · ' : '') + by;
    return when;
};

/**
 * Unified "note reminder" modal (dashboard + calendar day).
 * opts: { date?: 'YYYY-MM-DD'|'', onCreated?: fn }
 */
window.showNoteReminderModal = async function(opts) {
    const options = opts && typeof opts === 'object' ? opts : { date: opts || '' };
    const dateVal = options.date != null ? String(options.date).trim().slice(0, 10) : '';
    const presetDate = /^\d{4}-\d{2}-\d{2}$/.test(dateVal) ? dateVal : '';
    const todayLocal = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    const onCreated = typeof options.onCreated === 'function' ? options.onCreated : null;
    window._noteReminderOnCreated = onCreated;
    const draftKey = presetDate ? ('note_reminder_' + presetDate) : 'note_reminder_dash';
    const draft = (typeof DraftStore !== 'undefined' && DraftStore.load(draftKey)) || {};
    const initialHtml = draft.message || '';
    const initialDate = draft.remind_date || presetDate || todayLocal;
    const me = (API.getCurrentUser && API.getCurrentUser())?.name || '';
    let users = [];
    try { users = await API.get('/api/users') || []; } catch (e) { users = []; }
    if (!users.length && me) users = [{ name: me }];
    const forUser = draft.for_user || me;
    const userOpts = users.map(u => {
        const n = u.name || u.username || '';
        return `<option value="${escapeHtmlAttr(n)}"${n === forUser ? ' selected' : ''}>${escapeHtmlText(n)}</option>`;
    }).join('');

    const overlay = document.getElementById('modalOverlay');
    if (!overlay) {
        if (typeof showToast === 'function') showToast('Модальное окно недоступно', 'error');
        return;
    }
    overlay.innerHTML = `
        <div class="modal modal-lg" onclick="event.stopPropagation()" data-draft-key="${escapeHtmlAttr(draftKey)}">
            <div class="modal-header">
                <h3 class="modal-title">Новое напоминание</h3>
                <button class="modal-close" onclick="closeModal(true)" aria-label="Закрыть">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Текст *</label>
                    ${renderRichEditor('noteRemBody', initialHtml, 'О чём напомнить…', { alwaysOpen: true })}
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="noteRemDate">Дата</label>
                        <input type="date" class="form-input" id="noteRemDate" value="${escapeHtmlAttr(initialDate)}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="noteRemForUser">Для кого *</label>
                        <select class="form-select" id="noteRemForUser">${userOpts}</select>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button type="button" class="btn btn-secondary" onclick="closeModal(true)">Отмена</button>
                <button type="button" class="btn btn-primary" id="noteRemSubmitBtn">Создать</button>
            </div>
        </div>`;
    overlay.classList.add('show');
    document.body.style.overflow = 'hidden';

    const collectDraft = () => ({
        message: getDescValue('noteRemBody'),
        remind_date: document.getElementById('noteRemDate')?.value || '',
        for_user: document.getElementById('noteRemForUser')?.value || ''
    });

    bindRichEditor('noteRemBody', {
        onChange: () => {
            if (typeof DraftStore === 'undefined') return;
            DraftStore.save(draftKey, collectDraft());
        }
    });
    const wrap = document.querySelector('[data-rich-wrap="noteRemBody"]');
    const body = document.getElementById('noteRemBody');
    if (wrap && body) {
        wrap.classList.remove('rich-collapsed');
        wrap.dataset.richOpen = '1';
        wrap.style.minHeight = '180px';
        wrap.style.resize = 'vertical';
        wrap.style.overflow = 'auto';
        // Open for typing: clear stuck placeholder class (like openEditor)
        if (stripHtmlText(initialHtml)) {
            body.classList.remove('rich-empty');
        } else {
            body.innerHTML = '';
            body.classList.remove('rich-empty');
        }
        body.contentEditable = 'true';
        setTimeout(() => {
            body.focus();
            if (!stripHtmlText(body.innerHTML)) {
                body.classList.remove('rich-empty');
                body.innerHTML = '';
            }
        }, 40);
    }
    if (typeof DraftStore !== 'undefined') {
        DraftStore.bind(draftKey, collectDraft, () => {});
    }
    document.getElementById('noteRemSubmitBtn')?.addEventListener('click', () => {
        window.createNoteReminderFromModal(draftKey);
    });
};

// Back-compat aliases
window.showNewNoteReminderModal = function(defaultDate) {
    const d = defaultDate == null ? '' : String(defaultDate);
    window.showNoteReminderModal({ date: d });
};

window.createNoteReminderFromModal = async function(draftKey) {
    const modal = document.querySelector('.modal-overlay.show .modal') || document;
    const submitBtn = document.getElementById('noteRemSubmitBtn') || modal.querySelector('.btn-primary');
    await withButtonLock(submitBtn, async () => {
        const message = getDescValue('noteRemBody');
        if (!stripHtmlText(message)) {
            showToast('Введите текст напоминания', 'error');
            return;
        }
        const d = document.getElementById('noteRemDate')?.value || '';
        if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
            showToast('Некорректная дата', 'error');
            return;
        }
        const for_user = document.getElementById('noteRemForUser')?.value || '';
        if (!for_user) {
            showToast('Выберите пользователя', 'error');
            return;
        }
        const payload = { message, remind_date: d, for_user };
        try {
            await API.post('/api/reminders', payload);
        } catch (err) {
            showToast('Ошибка: ' + (err.message || 'не создано'), 'error');
            return;
        }
        if (draftKey && typeof DraftStore !== 'undefined') DraftStore.clear(draftKey);
        closeModal();
        showToast('Напоминание создано', 'success');
        const cb = window._noteReminderOnCreated;
        window._noteReminderOnCreated = null;
        if (typeof cb === 'function') await cb();
    });
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCommonUI();
    initCopyButtons();
    initInlineEdit();
    initGlobalHotkeys();
    setInterval(pollRealtimeChanges, 7000);
});
