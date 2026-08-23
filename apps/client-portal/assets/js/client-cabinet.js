(() => {
  'use strict';

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function initials(name) {
    const p = String(name || '').trim().split(/\s+/);
    if (!p[0]) return 'К';
    return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  }
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '.' + p(d.getMonth() + 1);
  }
  function tokenFromPath() {
    const m = location.pathname.match(/^\/c\/([^/]+)/);
    if (m) return decodeURIComponent(m[1]);
    return new URLSearchParams(location.search).get('t') || new URLSearchParams(location.search).get('token') || '';
  }
  function bars(items) {
    const max = Math.max(1, ...items.map((v) => v.count || 0));
    return items.map((v) => {
      const h = v.count ? Math.max(8, Math.round((v.count / max) * 100)) : 4;
      return `<i class="${v.count ? 'on' : ''}" style="height:${h}%" title="${esc(v.day || '')}: ${v.count || 0}"></i>`;
    }).join('');
  }

  const token = tokenFromPath();
  const root = document.getElementById('app');
  if (!token) {
    root.innerHTML = '<div class="cp-err"><h2>Ссылка неполная</h2><p>Откройте полную ссылку от менеджера.</p></div>';
    return;
  }

  let currentId = '';
  let bundle = null;

  function projectOf(id) {
    if (!bundle) return null;
    if (bundle.projects && bundle.projects.length) {
      return bundle.projects.find((p) => (p.id || p.project && p.project.id) === id) || bundle.projects[0];
    }
    return bundle;
  }

  function render() {
    const data = projectOf(currentId) || bundle;
    const p = data.project || {};
    const st = data.stats || {};
    const tasks = data.tasks || [];
    const acts = data.activity || [];
    const docs = data.documents || [];
    const comments = data.comments || [];
    const approvals = data.approvals || [];
    const visits = data.visits || [];
    currentId = p.id || currentId;
    const preview = !!bundle.preview;
    document.title = (p.name || 'Проект') + ' — Vantegra';

    const projectList = (bundle.projects || [data]).map((item) => {
      const pr = item.project || item;
      const id = pr.id || item.id;
      return `<button type="button" data-open-project="${esc(id)}" ${id === currentId ? 'aria-current="true"' : ''}>${esc(pr.name || 'Проект')}</button>`;
    }).join('');

    root.innerHTML = `
      <div class="lk">
        <aside class="lk__side">
          <a class="lk__mark" href="https://vantegracode.ru/">Vantegra</a>
          <nav class="lk__nav" aria-label="Разделы кабинета">
            <button type="button" data-panel="home" aria-current="true">Обзор</button>
            <button type="button" data-panel="projects">Проекты</button>
            <button type="button" data-panel="tasks">Этапы</button>
            <button type="button" data-panel="files">Файлы</button>
            <button type="button" data-panel="talk">Согласования</button>
          </nav>
          <div class="lk__foot">
            <div class="lk__user">
              <span class="lk__ava">${esc(initials(p.client))}</span>
              <span class="lk__who"><b>${esc(p.client || 'Клиент')}</b><span class="lk__mail">${esc(p.name || '')}</span></span>
            </div>
          </div>
        </aside>
        <main class="lk__main">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <h1 class="lk__title" id="lkTitle">Обзор</h1>
            ${preview ? '<span class="badge">Превью</span>' : ''}
          </div>

          <section class="lk__panel is-on" id="p-home">
            <ul class="tiles">
              <li class="tile"><span>Готовность</span><b>${st.progress || 0}%</b></li>
              <li class="tile"><span>Этапов готово</span><b>${st.done || 0}/${st.total || 0}</b></li>
              <li class="tile"><span>Дедлайн</span><b style="font-size:28px">${esc(p.deadline || '—')}</b></li>
            </ul>
            ${data.stats_enabled !== false ? `<p class="lk__mail">Заходы 30 дней · ${data.visitsTotal || 0}</p><div class="chart">${bars(visits)}</div>` : ''}
            <h2>Последние события</h2>
            <ul class="rows">${acts.length ? acts.slice(0, 8).map((a) => `<li><b>${esc(a.details || a.action)}</b><span class="pill">${esc(a.action)}</span><time>${esc(when(a.created_at))}</time></li>`).join('') : '<li>Пока тихо — как только появится движение, оно будет здесь.</li>'}</ul>
          </section>

          <section class="lk__panel" id="p-projects">
            <div class="lk__nav" style="max-width:420px;margin-bottom:24px">${projectList}</div>
            <p>${esc(p.description || 'Описание проекта появится здесь.')}</p>
            <div class="field">
              <label for="cpSiteUrl">Адрес сайта</label>
              <input id="cpSiteUrl" value="${esc(data.site_url || '')}" placeholder="https://ваш-сайт.ru" ${preview ? 'disabled' : ''}>
            </div>
            <button class="btn" type="button" id="cpSiteSave" ${preview ? 'disabled' : ''}>Сохранить</button>
            <p class="msg" id="cpSiteMsg"></p>
          </section>

          <section class="lk__panel" id="p-tasks">
            <ul class="rows">${tasks.length ? tasks.map((t) => `
              <li>
                <b>${t.done ? '✓ ' : ''}${esc(t.name)}</b>
                <span class="pill ${t.done ? '' : 'pill--go'}">${esc(t.status)}</span>
                <span class="row-actions">
                  <button class="btn btn--plain" type="button" data-approve="${esc(t.id)}" ${preview ? 'disabled' : ''}>Ок</button>
                  <button class="btn btn--plain" type="button" data-reject="${esc(t.id)}" ${preview ? 'disabled' : ''}>Нет</button>
                </span>
              </li>`).join('') : '<li>Этапов пока нет</li>'}</ul>
          </section>

          <section class="lk__panel" id="p-files">
            <ul class="rows">${docs.length ? docs.map((d) => `<li><b>${esc(d.name)}</b><span class="pill">${esc(d.type || 'файл')}</span><time>${esc(when(d.created_at))}</time></li>`).join('') : '<li>Файлов пока нет</li>'}</ul>
          </section>

          <section class="lk__panel" id="p-talk">
            <ul class="rows">${comments.length ? comments.map((c) => `<li><b>${esc(c.body)}</b><span class="pill">${esc(c.author_kind)}</span><time>${esc(when(c.created_at))}</time></li>`).join('') : '<li>Комментариев нет</li>'}</ul>
            <div class="field">
              <label for="cpComment">Комментарий студии</label>
              <textarea id="cpComment" rows="3" ${preview ? 'disabled' : ''}></textarea>
            </div>
            <button class="btn" type="button" id="cpCommentSend" ${preview ? 'disabled' : ''}>Отправить</button>
            <p class="msg" id="cpCommentMsg"></p>
            <h2>Согласования</h2>
            <ul class="rows">${approvals.length ? approvals.map((a) => `<li><b>${esc(a.status)}</b><span>${esc(a.comment || '')}</span><time>${esc(when(a.decided_at || a.created_at))}</time></li>`).join('') : '<li>Ещё не было решений</li>'}</ul>
          </section>
        </main>
      </div>
    `;

    root.querySelectorAll('[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-panel');
        root.querySelectorAll('[data-panel]').forEach((b) => b.setAttribute('aria-current', b === btn ? 'true' : 'false'));
        root.querySelectorAll('.lk__panel').forEach((pEl) => pEl.classList.toggle('is-on', pEl.id === 'p-' + id));
        const title = { home: 'Обзор', projects: 'Проекты', tasks: 'Этапы', files: 'Файлы', talk: 'Согласования' };
        const t = document.getElementById('lkTitle');
        if (t) t.textContent = title[id] || 'Кабинет';
      });
    });
    root.querySelectorAll('[data-open-project]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentId = btn.getAttribute('data-open-project');
        render();
      });
    });
    const save = document.getElementById('cpSiteSave');
    if (save) save.addEventListener('click', async () => {
      const msg = document.getElementById('cpSiteMsg');
      try {
        const r = await fetch('/api/public/client/' + encodeURIComponent(token) + '/site', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ site_url: document.getElementById('cpSiteUrl').value })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Ошибка');
        if (msg) { msg.className = 'msg ok'; msg.textContent = 'Сохранено'; }
      } catch (e) {
        if (msg) { msg.className = 'msg err'; msg.textContent = e.message; }
      }
    });
    const send = document.getElementById('cpCommentSend');
    if (send) send.addEventListener('click', async () => {
      const msg = document.getElementById('cpCommentMsg');
      const body = document.getElementById('cpComment').value.trim();
      try {
        const r = await fetch('/api/public/client/' + encodeURIComponent(token) + '/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body, task_id: '' })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Ошибка');
        await reload();
      } catch (e) {
        if (msg) { msg.className = 'msg err'; msg.textContent = e.message; }
      }
    });
    root.querySelectorAll('[data-approve],[data-reject]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const status = btn.hasAttribute('data-approve') ? 'approved' : 'rejected';
        const taskId = btn.getAttribute('data-approve') || btn.getAttribute('data-reject');
        await fetch('/api/public/client/' + encodeURIComponent(token) + '/approvals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status, task_id: taskId })
        });
        await reload();
      });
    });
  }

  async function reload() {
    const res = await fetch('/api/public/client/' + encodeURIComponent(token));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не найдено');
    bundle = data;
    currentId = data.current_project_id || (data.project && data.project.id) || currentId;
    render();
  }

  (async function boot() {
    try {
      if (!location.pathname.endsWith('/preview') && !/\/preview\/?$/.test(location.pathname)) {
        fetch('/api/public/client/' + encodeURIComponent(token) + '/visit', { method: 'POST' }).catch(() => {});
      }
      await reload();
    } catch (e) {
      root.innerHTML = `<div class="cp-err"><h2>Не удалось открыть</h2><p>${esc(e.message || e)}</p></div>`;
    }
  })();
})();