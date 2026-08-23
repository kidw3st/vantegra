/**
 * CRM Dashboard layout: config storage, validation, grid helpers.
 */
(function (global) {
  const CONFIG_TYPE = 'crm-dashboard-config';
  const CONFIG_VERSION = 4;
  const COLS = 96;
  const ROW_PX = 12;
  const GAP_PX = 4;
  const ALLOWED_TYPES = ['stats', 'documents', 'tasks', 'projects', 'goals', 'reminders', 'calendar', 'finances'];
  const WIDGET_META = {
    // stats can shrink horizontally; CSS keeps 4 cards visible
    stats: { title: 'Статистика', minW: 24, minH: 6, defaultW: 96, defaultH: 6 },
    documents: { title: 'Документы', minW: 16, minH: 14, defaultW: 32, defaultH: 28 },
    tasks: { title: 'Задачи', minW: 16, minH: 12, defaultW: 32, defaultH: 18 },
    projects: { title: 'Проекты', minW: 16, minH: 12, defaultW: 32, defaultH: 18 },
    goals: { title: 'Цели', minW: 16, minH: 10, defaultW: 64, defaultH: 14 },
    reminders: { title: 'Напоминания', minW: 16, minH: 10, defaultW: 64, defaultH: 14 },
    calendar: { title: 'Календарь', minW: 16, minH: 12, defaultW: 48, defaultH: 20 },
    finances: { title: 'Финансы', minW: 16, minH: 12, defaultW: 48, defaultH: 12 }
  };

  /** Bump when shipping a new shared base layout (one-time reset for all users). */
  const BASE_LAYOUT_REV = '20260803a';

  function storageKey(user) {
    const id = (user && (user.id || user.username || user.name)) || 'guest';
    return 'crm_dash_config_' + BASE_LAYOUT_REV + '_' + String(id);
  }

  function uid() {
    return 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  /** Shared base layout (96-col). Narrow screens: fitBoardScale() in dashboard.html. */
  const BASE_WIDGETS = [
    { id: 'w_base_stats', type: 'stats', x: 0, y: 0, w: 32, h: 11, filter: '' },
    { id: 'w_base_documents', type: 'documents', x: 0, y: 12, w: 32, h: 36, filter: '' },
    { id: 'w_base_tasks', type: 'tasks', x: 33, y: 0, w: 31, h: 34, filter: '' },
    { id: 'w_base_projects', type: 'projects', x: 65, y: 0, w: 31, h: 34, filter: '' },
    { id: 'w_base_goals', type: 'goals', x: 33, y: 35, w: 31, h: 13, filter: '' },
    { id: 'w_base_finances', type: 'finances', x: 65, y: 35, w: 31, h: 13, filter: '' },
    { id: 'w_base_calendar', type: 'calendar', x: 0, y: 49, w: 48, h: 16, filter: '3' },
    { id: 'w_base_reminders', type: 'reminders', x: 49, y: 49, w: 47, h: 16, filter: '' }
  ];

  function defaultConfig() {
    return {
      type: CONFIG_TYPE,
      version: CONFIG_VERSION,
      widgets: BASE_WIDGETS.map(w => ({ ...w }))
    };
  }

  function clampInt(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  function scaleWidgets(widgets, factor) {
    return widgets.map(w => ({
      ...w,
      x: clampInt((Number(w.x) || 0) * factor, 0, COLS - 1, 0),
      w: clampInt((Number(w.w) || 1) * factor, 1, COLS, 24),
      y: clampInt(w.y, 0, 1200, 0),
      h: clampInt(Math.max(Number(w.h) || 2, 2), 2, 120, 10)
    }));
  }

  /** Migrate older configs → v4 (96 cols) silently */
  function migrateToCurrent(cfg) {
    if (!cfg || !Array.isArray(cfg.widgets)) return cfg;
    if (cfg.version === 4) return cfg;
    if (cfg.version === 3) {
      return { type: CONFIG_TYPE, version: CONFIG_VERSION, widgets: scaleWidgets(cfg.widgets, 2) };
    }
    if (cfg.version === 2) {
      return { type: CONFIG_TYPE, version: CONFIG_VERSION, widgets: scaleWidgets(cfg.widgets, 4) };
    }
    if (cfg.version === 1) {
      return { type: CONFIG_TYPE, version: CONFIG_VERSION, widgets: scaleWidgets(cfg.widgets, 8) };
    }
    return cfg;
  }

  function normalizeWidget(raw, meta) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const type = String(raw.type || '');
    if (!ALLOWED_TYPES.includes(type)) return null;
    const m = meta[type];
    const w = clampInt(raw.w, m.minW, COLS, m.defaultW);
    const h = clampInt(raw.h, m.minH, 120, m.defaultH);
    const x = clampInt(raw.x, 0, COLS - w, 0);
    const y = clampInt(raw.y, 0, 1200, 0);
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 64) : uid();
    const filter = typeof raw.filter === 'string' ? raw.filter.slice(0, 80) : '';
    const allowedKeys = { id: 1, type: 1, x: 1, y: 1, w: 1, h: 1, filter: 1 };
    for (const k of Object.keys(raw)) {
      if (!allowedKeys[k]) return null;
    }
    return { id, type, x, y, w, h, filter };
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function canPlace(widgets, candidate, ignoreId) {
    if (!candidate) return false;
    if (candidate.x < 0 || candidate.y < 0) return false;
    if (candidate.w < 1 || candidate.h < 1) return false;
    if (candidate.x + candidate.w > COLS) return false;
    return !widgets.some(w => w.id !== ignoreId && rectsOverlap(candidate, w));
  }

  function hasOverlaps(widgets) {
    for (let i = 0; i < widgets.length; i++) {
      for (let j = i + 1; j < widgets.length; j++) {
        if (rectsOverlap(widgets[i], widgets[j])) return true;
      }
    }
    return false;
  }

  /** Quietly push overlapping widgets into free cells (stable visual update). */
  function resolveOverlaps(widgets) {
    const order = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x || String(a.id).localeCompare(String(b.id)));
    const placed = [];
    for (const w of order) {
      let cand = { ...w, x: clampInt(w.x, 0, COLS - w.w, 0), y: Math.max(0, w.y | 0) };
      if (canPlace(placed, cand, null)) {
        placed.push(cand);
        continue;
      }
      let found = null;
      const maxScan = Math.max(cand.y + 80, 80);
      for (let y = cand.y; y <= maxScan && !found; y++) {
        for (let x = 0; x <= COLS - cand.w; x++) {
          const tryW = { ...cand, x, y };
          if (canPlace(placed, tryW, null)) {
            found = tryW;
            break;
          }
        }
      }
      if (!found) {
        const maxY = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
        found = { ...cand, x: 0, y: maxY };
      }
      placed.push(found);
    }
    const byId = new Map(placed.map(p => [p.id, p]));
    return widgets.map(w => byId.get(w.id) || w);
  }

  function nextPlacement(widgets, type) {
    const m = WIDGET_META[type];
    const w = m.defaultW;
    const h = m.defaultH;
    let maxY = 0;
    widgets.forEach(x => { maxY = Math.max(maxY, x.y + x.h); });
    for (let y = 0; y <= maxY + 4; y++) {
      for (let x = 0; x <= COLS - w; x++) {
        const cand = { id: uid(), type, x, y, w, h, filter: type === 'calendar' ? '7' : '' };
        if (canPlace(widgets, cand, null)) return cand;
      }
    }
    return { id: uid(), type, x: 0, y: maxY, w, h, filter: type === 'calendar' ? '7' : '' };
  }

  function validateConfig(input) {
    if (typeof input === 'string') {
      if (input.length > 200000) return { ok: false, error: 'Файл слишком большой' };
      try { input = JSON.parse(input); }
      catch (_) { return { ok: false, error: 'Невалидный JSON' }; }
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Конфиг должен быть объектом' };
    }
    const allowedTop = { type: 1, version: 1, widgets: 1 };
    for (const k of Object.keys(input)) {
      if (!allowedTop[k]) return { ok: false, error: 'Лишнее поле: ' + k };
    }
    if (input.type !== CONFIG_TYPE) {
      return { ok: false, error: 'Неверный type (ожидается crm-dashboard-config)' };
    }
    if (![1, 2, 3, 4].includes(input.version)) {
      return { ok: false, error: 'Неподдерживаемая версия конфига' };
    }
    if (!Array.isArray(input.widgets)) {
      return { ok: false, error: 'widgets должен быть массивом' };
    }
    if (input.widgets.length > 40) {
      return { ok: false, error: 'Слишком много блоков (макс. 40)' };
    }
    const cfg = migrateToCurrent(input);
    const widgets = [];
    const ids = new Set();
    for (const raw of cfg.widgets) {
      const w = normalizeWidget(raw, WIDGET_META);
      if (!w) return { ok: false, error: 'Некорректный блок в widgets' };
      if (ids.has(w.id)) return { ok: false, error: 'Дублируется id блока' };
      ids.add(w.id);
      widgets.push(w);
    }
    return { ok: true, config: { type: CONFIG_TYPE, version: CONFIG_VERSION, widgets } };
  }

  function loadConfig(user) {
    try {
      const raw = localStorage.getItem(storageKey(user));
      if (!raw) return defaultConfig();
      const res = validateConfig(raw);
      if (!res.ok) return defaultConfig();
      // Silent de-overlap + migrate persist — layout stays usable, no user action
      const fixed = {
        ...res.config,
        widgets: resolveOverlaps(res.config.widgets)
      };
      try { localStorage.setItem(storageKey(user), JSON.stringify(fixed)); } catch (_) {}
      return fixed;
    } catch (_) {
      return defaultConfig();
    }
  }

  function saveConfig(user, config) {
    const res = validateConfig(config);
    if (!res.ok) throw new Error(res.error);
    if (hasOverlaps(res.config.widgets)) {
      throw new Error('Блоки накладываются друг на друга');
    }
    localStorage.setItem(storageKey(user), JSON.stringify(res.config));
    return res.config;
  }

  function exportConfig(user) {
    return JSON.stringify(loadConfig(user), null, 2);
  }

  function importConfig(user, raw) {
    const res = validateConfig(raw);
    if (!res.ok) return res;
    const fixed = { ...res.config, widgets: resolveOverlaps(res.config.widgets) };
    localStorage.setItem(storageKey(user), JSON.stringify(fixed));
    return { ok: true, config: fixed };
  }

  function boardMetrics(boardEl) {
    const rect = boardEl.getBoundingClientRect();
    const styles = getComputedStyle(boardEl);
    const gap = parseFloat(styles.columnGap || styles.gap) || GAP_PX;
    const rowH = parseFloat(styles.gridAutoRows) || ROW_PX;
    const colW = (rect.width - gap * (COLS - 1)) / COLS;
    return { rect, gap, rowH, colW, stepX: colW + gap, stepY: rowH + gap };
  }

  global.DashBoard = {
    COLS,
    ROW_PX,
    GAP_PX,
    ALLOWED_TYPES,
    WIDGET_META,
    CONFIG_TYPE,
    CONFIG_VERSION,
    BASE_LAYOUT_REV,
    storageKey,
    uid,
    defaultConfig,
    validateConfig,
    loadConfig,
    saveConfig,
    exportConfig,
    importConfig,
    nextPlacement,
    normalizeWidget,
    boardMetrics,
    rectsOverlap,
    canPlace,
    hasOverlaps,
    resolveOverlaps
  };
})(window);
