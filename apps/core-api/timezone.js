/**
 * App timezone helpers (default: Perm / Asia/Yekaterinburg).
 */
const DEFAULT_TZ = 'Asia/Yekaterinburg';

const ALLOWED_TZ = [
  'Asia/Yekaterinburg', // Пермь UTC+5
  'Europe/Moscow',
  'Europe/Samara',
  'Asia/Omsk',
  'Asia/Novosibirsk',
  'Asia/Krasnoyarsk',
  'Asia/Irkutsk',
  'Asia/Vladivostok',
  'Europe/Kaliningrad',
  'UTC'
];

const TZ_LABELS = {
  'Asia/Yekaterinburg': 'Пермь (UTC+5)',
  'Europe/Moscow': 'Москва (UTC+3)',
  'Europe/Samara': 'Самара (UTC+4)',
  'Asia/Omsk': 'Омск (UTC+6)',
  'Asia/Novosibirsk': 'Новосибирск (UTC+7)',
  'Asia/Krasnoyarsk': 'Красноярск (UTC+7)',
  'Asia/Irkutsk': 'Иркутск (UTC+8)',
  'Asia/Vladivostok': 'Владивосток (UTC+10)',
  'Europe/Kaliningrad': 'Калининград (UTC+2)',
  UTC: 'UTC'
};

function normalizeTz(tz) {
  const s = String(tz || '').trim();
  return ALLOWED_TZ.includes(s) ? s : DEFAULT_TZ;
}

function partsInTz(date, tz) {
  const d = date instanceof Date ? date : new Date(date);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTz(tz),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const map = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  // en-CA hour can be "24" at midnight in some engines — normalize
  let hour = map.hour || '00';
  if (hour === '24') hour = '00';
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour,
    minute: map.minute || '00',
    second: map.second || '00'
  };
}

function todayISO(tz = DEFAULT_TZ) {
  const p = partsInTz(new Date(), tz);
  return `${p.year}-${p.month}-${p.day}`;
}

function nowTimeISO(tz = DEFAULT_TZ) {
  const p = partsInTz(new Date(), tz);
  return `${p.hour}:${p.minute}:${p.second}`;
}

function formatDateTime(value, tz = DEFAULT_TZ) {
  if (value == null || value === '') return '';
  let raw = String(value).trim();
  if (!raw.includes('T') && /^\d{4}-\d{2}-\d{2} /.test(raw)) {
    raw = raw.replace(' ', 'T') + 'Z';
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.slice(8, 10) + '.' + raw.slice(5, 7) + '.' + raw.slice(0, 4);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = partsInTz(d, tz);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/** Calendar day arithmetic without UTC midnight quirks */
function addDaysISO(dateStr, days) {
  if (!dateStr) return '';
  const m = String(dateStr).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + (Number(days) || 0)));
  return dt.toISOString().slice(0, 10);
}

function dayDelta(oldTz, newTz, at = new Date()) {
  const a = todayISO(oldTz);
  const b = todayISO(newTz);
  if (a === b) return 0;
  const am = a.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const bm = b.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!am || !bm) return 0;
  const da = Date.UTC(+am[1], +am[2] - 1, +am[3]);
  const db = Date.UTC(+bm[1], +bm[2] - 1, +bm[3]);
  return Math.round((db - da) / 86400000);
}

function shiftISODate(dateStr, days) {
  if (!dateStr || !days) return dateStr;
  const s = String(dateStr).trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return dateStr;
  return addDaysISO(s.slice(0, 10), days) + s.slice(10);
}

function listTimezones() {
  return ALLOWED_TZ.map(id => ({ id, label: TZ_LABELS[id] || id }));
}

module.exports = {
  DEFAULT_TZ,
  ALLOWED_TZ,
  TZ_LABELS,
  normalizeTz,
  partsInTz,
  todayISO,
  nowTimeISO,
  formatDateTime,
  addDaysISO,
  dayDelta,
  shiftISODate,
  listTimezones
};
