/**
 * Async analytics sink. Never throws into the HTTP path.
 */
function enabled() {
  return !!process.env.CLICKHOUSE_URL;
}

function truncateIp(ip) {
  const s = String(ip || '');
  if (s.includes(':')) {
    const parts = s.split(':').filter(Boolean);
    return parts.slice(0, 4).join(':') + '::';
  }
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return '';
  return `${m[1]}.${m[2]}.${m[3]}.0`;
}

async function insertEvents(rows) {
  if (!enabled() || !rows || !rows.length) return false;
  const base = String(process.env.CLICKHOUSE_URL).replace(/\/$/, '');
  const sql = 'INSERT INTO vantegra.portal_events FORMAT JSONEachRow';
  const body = rows.map((r) => JSON.stringify({
    occurred_at: r.occurred_at || new Date().toISOString().replace('T', ' ').slice(0, 19),
    event_type: r.event_type || 'visit',
    project_id: r.project_id || '',
    link_id: r.link_id || '',
    ip_truncated: r.ip_truncated || '',
    user_agent: String(r.user_agent || '').slice(0, 255)
  })).join('\n');
  try {
    const res = await fetch(base + '/?query=' + encodeURIComponent(sql), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('clickhouse insert', res.status, t.slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('clickhouse:', e.message);
    return false;
  }
}

async function visitSeries(projectId, days = 30) {
  if (!enabled()) return null;
  const base = String(process.env.CLICKHOUSE_URL).replace(/\/$/, '');
  const sql = `
    SELECT toString(day) AS day, count AS count
    FROM vantegra.portal_visits_daily
    WHERE project_id = {pid:String}
      AND day >= today() - ${Number(days) || 30}
    ORDER BY day ASC
  `;
  try {
    const url = base + '/?query=' + encodeURIComponent(sql) + '&param_pid=' + encodeURIComponent(projectId);
    const res = await fetch(url);
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim().split('\n').filter(Boolean).map((line) => {
      const [day, count] = line.split('\t');
      return { day, count: Number(count) || 0 };
    });
  } catch (e) {
    console.error('clickhouse series:', e.message);
    return null;
  }
}

module.exports = { enabled, truncateIp, insertEvents, visitSeries };