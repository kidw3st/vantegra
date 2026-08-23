/**
 * Client portal — full Basic functionality × 17 unique full-screen layouts.
 * Content blocks are identical; only shell / visual / animation differ.
 */
(function (global) {
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function actLabel(a) {
    if (a.action === 'complete_task') return 'Готово: ' + (a.details || 'задача');
    if (a.action === 'create_task') return 'Добавлен этап: ' + (a.details || '');
    if (a.action === 'change_status') return 'Статус: ' + (a.details || '');
    return a.details || a.action;
  }
  function fmtWhen(iso) {
    if (!iso) return '';
    try {
      const x = new Date(iso);
      const p = n => String(n).padStart(2, '0');
      return p(x.getDate()) + '.' + p(x.getMonth() + 1) + ' ' + p(x.getHours()) + ':' + p(x.getMinutes());
    } catch (e) { return iso; }
  }

  function bars(items, getC) {
    const max = Math.max(1, ...items.map(getC));
    return items.map(it => {
      const c = getC(it);
      const h = c ? Math.max(8, Math.round((c / max) * 100)) : 3;
      return `<i class="${c ? 'on' : ''}" style="height:${h}%"></i>`;
    }).join('');
  }

  /** Full Basic-equivalent content fragments */
  function sections(ctx) {
    const { p, pct, done, total, byStatus, weeks, tasks, acts, docs, showVisits, visits, visitsTotal, siteUrl, isPreview, themeLabel } = ctx;
    const head = `
      <div class="cp-sec cp-sec-head" data-sec="head">
        <div class="cp-kicker">${esc(themeLabel || 'Кабинет')}${isPreview ? ' · preview' : ''}</div>
        <h1 class="cp-h1">${esc(p.name || 'Проект')}</h1>
        <p class="cp-lead">${esc(p.client || '')}${p.status ? ' · ' + esc(p.status) : ''}${p.deadline ? ' · до ' + esc(p.deadline) : ''}</p>
      </div>`;
    const progress = `
      <section class="cp-sec" data-sec="progress">
        <h2>Готовность</h2>
        <div class="cp-pct" id="cpPctNum">${pct}%</div>
        <p class="cp-muted">${done} из ${total} этапов</p>
        <div class="cp-bar"><i class="fill-anim" data-w="${pct}"></i></div>
      </section>`;
    const site = `
      <section class="cp-sec" data-sec="site">
        <h2>Сайт · заходы · графики</h2>
        <div class="cp-site-row">
          <input id="cpSiteUrl" placeholder="https://ваш-сайт.ru" value="${esc(siteUrl || '')}">
          <button type="button" id="cpSiteSave">Сохранить</button>
        </div>
        <div id="cpSiteMsg" class="cp-msg"></div>
        <div id="cpSiteCurrent" class="cp-muted">${siteUrl
          ? 'Сейчас: <a href="' + esc(siteUrl) + '" target="_blank" rel="noopener">' + esc(siteUrl) + '</a>'
          : 'Сайт ещё не указан'}</div>
        ${showVisits ? `
          <p class="cp-muted">Заходы 30 дней · всего: ${visitsTotal}</p>
          <div class="cp-chart">${bars(visits, v => v.count)}</div>
          <p class="cp-muted">По неделям</p>
          <div class="cp-chart">${bars(weeks, w => w.count)}</div>
        ` : '<p class="cp-muted">Статистика выключена</p>'}
      </section>`;
    const taskList = `
      <section class="cp-sec" data-sec="tasks">
        <h2>Этапы</h2>
        ${tasks.length ? tasks.map(t => `
          <div class="cp-row ${t.done ? 'done' : ''}">
            <span>${t.done ? '✓ ' : ''}${esc(t.name)}</span>
            <span class="cp-muted">${esc(t.status)}</span>
          </div>`).join('') : '<p class="cp-muted">Нет этапов</p>'}
      </section>`;
    const statuses = `
      <section class="cp-sec" data-sec="statuses">
        <h2>Статусы</h2>
        ${byStatus.length ? byStatus.map(s => `
          <div class="cp-row"><span>${esc(s.name)}</span><span>${s.count}</span></div>
        `).join('') : '<p class="cp-muted">Нет данных</p>'}
      </section>`;
    const activity = acts.length ? `
      <section class="cp-sec" data-sec="activity">
        <h2>Что сделано</h2>
        ${acts.slice(0, 12).map(a => `
          <div class="cp-row"><span>${esc(actLabel(a))}</span><span class="cp-muted">${esc(fmtWhen(a.created_at))}</span></div>
        `).join('')}
      </section>` : '';
    const documents = docs.length ? `
      <section class="cp-sec" data-sec="docs">
        <h2>Документы</h2>
        ${docs.map(d => `
          <div class="cp-row"><span>${esc(d.name)}</span><span class="cp-muted">${esc(d.type || '')}</span></div>
        `).join('')}
      </section>` : '';
    return { head, progress, site, taskList, statuses, activity, documents };
  }

  function stack(s) {
    return s.head + s.progress + s.site + s.taskList + s.statuses + s.activity + s.documents;
  }

  const THEMES = ['basic'];
  const LABELS = {
    basic: 'Basic', neon: 'Neon', nebula: 'Nebula', radiant: 'Radiant', lumen: 'Lumen',
    datacore: 'Datacore', focus: 'Focus', flowfield: 'Flow Field', emberflow: 'Ember Flow',
    oceanflow: 'Ocean Flow', springkit: 'Spring Kit', magnet: 'Magnet', clipwipe: 'Clip Wipe',
    pathdraw: 'Path Draw', cascade: 'Cascade', meshglow: 'Mesh Glow', ticker: 'Ticker'
  };

  const CSS = `
    .cp-root { min-height:100vh; position:relative; color:inherit; }
    .cp-canvas { position:fixed; inset:0; z-index:0; pointer-events:none; }
    .cp-kicker { font-size:11px; letter-spacing:.14em; text-transform:uppercase; opacity:.65; margin-bottom:8px; }
    .cp-h1 { margin:0 0 8px; line-height:1.1; font-size:clamp(1.6rem,4vw,2.6rem); }
    .cp-lead { margin:0 0 18px; opacity:.7; }
    .cp-sec { margin-bottom:12px; }
    .cp-sec h2 { margin:0 0 10px; font-size:13px; letter-spacing:.08em; text-transform:uppercase; opacity:.7; }
    .cp-pct { font-size:clamp(2.4rem,8vw,4rem); font-weight:800; line-height:1; margin:0 0 6px; }
    .cp-muted { font-size:13px; opacity:.65; margin:6px 0; }
    .cp-bar { height:10px; background:rgba(127,127,127,.2); border-radius:6px; overflow:hidden; }
    .cp-bar > i { display:block; height:100%; width:0; background:currentColor; border-radius:6px; }
    .cp-site-row { display:flex; gap:8px; margin:8px 0; }
    .cp-site-row input { flex:1; height:42px; border-radius:8px; border:1px solid rgba(127,127,127,.35); padding:0 12px; font:inherit; background:rgba(255,255,255,.06); color:inherit; }
    .cp-site-row button { height:42px; padding:0 14px; border:0; border-radius:8px; font-weight:700; cursor:pointer; background:#111; color:#fff; }
    .cp-msg { min-height:1.2em; font-size:13px; }
    .cp-chart { display:flex; align-items:flex-end; gap:2px; height:64px; margin:8px 0 12px; }
    .cp-chart i { flex:1; display:block; background:rgba(127,127,127,.25); border-radius:2px 2px 0 0; }
    .cp-chart i.on { background:currentColor; }
    .cp-row { display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid rgba(127,127,127,.15); font-size:14px; }
    .cp-row.done { opacity:.55; }
    .cp-row:last-child { border-bottom:0; }
    @media(max-width:640px){ .cp-site-row{flex-direction:column;} }

    /* —— BASIC: centered column —— */
    .t-basic { background:#f3f4f6; color:#111827; }
    .t-basic .cp-shell { max-width:680px; margin:0 auto; padding:28px 16px 100px; }
    .t-basic .cp-sec { background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:16px; }
    .t-basic { color:#2563eb; }
    .t-basic .cp-h1, .t-basic .cp-lead, .t-basic .cp-row span:first-child { color:#111827; }
    .t-basic .cp-site-row input { background:#fff; color:#111; }
    .t-basic .cp-site-row button { background:#2563eb; color:#fff; }

    /* —— NEON: full-bleed split —— */
    .t-neon { background:#050508; color:#f8fafc; }
    .t-neon .cp-shell { display:grid; grid-template-columns:42vw 1fr; min-height:100vh; }
    .t-neon .cp-left {
      position:sticky; top:0; height:100vh; padding:40px 28px; display:flex; flex-direction:column; justify-content:flex-end;
      background:radial-gradient(circle at 30% 20%, rgba(0,240,255,.25), transparent 45%),
                 radial-gradient(circle at 80% 70%, rgba(255,43,214,.2), transparent 40%), #050508;
      border-right:1px solid rgba(0,240,255,.25);
    }
    .t-neon .cp-right { padding:28px 24px 100px; }
    .t-neon .cp-sec { border:1px solid rgba(0,240,255,.2); background:rgba(0,0,0,.4); padding:16px; margin-bottom:12px; }
    .t-neon { color:#00f0ff; }
    .t-neon .cp-site-row button { background:#00f0ff; color:#000; }
    @media(max-width:900px){ .t-neon .cp-shell{grid-template-columns:1fr;} .t-neon .cp-left{height:auto; position:relative;} }

    /* —— NEBULA: full viewport bento —— */
    .t-nebula { background:#06041a; color:#f5f0ff; }
    .t-nebula .cp-shell { max-width:1200px; margin:0 auto; padding:24px 16px 100px; min-height:100vh; }
    .t-nebula .cp-bento { display:grid; grid-template-columns:repeat(12,1fr); gap:12px; }
    .t-nebula .cp-sec { background:linear-gradient(160deg,rgba(167,139,250,.18),rgba(56,189,248,.06)); border:1px solid rgba(167,139,250,.3); border-radius:22px; padding:18px; }
    .t-nebula .span-12 { grid-column:span 12; }
    .t-nebula .span-7 { grid-column:span 7; }
    .t-nebula .span-5 { grid-column:span 5; }
    .t-nebula .span-6 { grid-column:span 6; }
    .t-nebula .span-4 { grid-column:span 4; }
    .t-nebula { color:#a78bfa; }
    .t-nebula .cp-site-row button { color:#fff; background:linear-gradient(90deg,#7c3aed,#38bdf8); }
    @media(max-width:800px){ .t-nebula .span-7,.t-nebula .span-5,.t-nebula .span-6,.t-nebula .span-4{grid-column:span 12;} }

    /* —— RADIANT: full-width magazine —— */
    .t-radiant { background:#12080c; color:#fff7f2; }
    .t-radiant .cp-shell { display:grid; grid-template-columns:1.15fr .85fr; gap:0; min-height:100vh; }
    .t-radiant .cp-main { padding:36px 28px 100px; border-right:1px solid rgba(251,146,60,.25); }
    .t-radiant .cp-aside { padding:36px 22px 100px; background:rgba(251,146,60,.06); }
    .t-radiant .cp-sec { border-bottom:1px solid rgba(255,255,255,.08); padding:0 0 18px; margin-bottom:18px; border-radius:0; background:transparent; }
    .t-radiant { color:#fb923c; }
    .t-radiant .cp-site-row button { background:#fb923c; color:#1a0a0c; }
    @media(max-width:900px){ .t-radiant .cp-shell{grid-template-columns:1fr;} .t-radiant .cp-main{border-right:0;} }

    /* —— LUMEN: full-bleed light band —— */
    .t-lumen { background:#f4f0e8; color:#171412; }
    .t-lumen .cp-band { background:#fff; border-bottom:1px solid #e5dfd3; padding:48px 8vw 36px; }
    .t-lumen .cp-shell { max-width:760px; margin:0 auto; padding:28px 16px 100px; }
    .t-lumen .cp-sec { background:#fff; border:1px solid #e5dfd3; padding:20px; margin-bottom:14px; }
    .t-lumen { color:#b45309; }
    .t-lumen .cp-h1 { font-family:Georgia,serif; font-weight:400; font-size:clamp(2.4rem,6vw,3.8rem); color:#171412; }
    .t-lumen .cp-site-row input { background:#faf7f2; color:#171412; }
    .t-lumen .cp-site-row button { background:#171412; color:#f4f0e8; }

    /* —— DATACORE: app shell full screen —— */
    .t-datacore { background:#0a1018; color:#e8eef5; font-family:IBM Plex Sans,system-ui,sans-serif; }
    .t-datacore .cp-shell { display:grid; grid-template-columns:220px 1fr; min-height:100vh; }
    .t-datacore .cp-nav { background:#0d1520; border-right:1px solid rgba(45,212,191,.2); padding:20px 14px; position:sticky; top:0; height:100vh; }
    .t-datacore .cp-nav a { display:block; padding:9px 10px; margin-bottom:4px; border-radius:8px; color:#7d8fa3; text-decoration:none; font-size:13px; }
    .t-datacore .cp-nav a:hover { background:rgba(45,212,191,.08); color:#fff; }
    .t-datacore .cp-body { padding:22px 22px 100px; }
    .t-datacore .cp-sec { background:#111a24; border:1px solid rgba(56,189,248,.16); border-radius:10px; padding:14px; }
    .t-datacore { color:#2dd4bf; }
    .t-datacore .cp-site-row button { background:#2dd4bf; color:#042f2e; }
    @media(max-width:900px){ .t-datacore .cp-shell{grid-template-columns:1fr;} .t-datacore .cp-nav{position:relative;height:auto;} }

    /* —— FOCUS: wide canvas, accent blocks —— */
    .t-focus { background:#fafafa; color:#171717; }
    .t-focus .cp-shell { max-width:920px; margin:0 auto; padding:32px 18px 100px; }
    .t-focus .cp-sec { background:#fff; border:2px solid #e5e5e5; border-radius:16px; padding:18px; }
    .t-focus .cp-sec[data-sec="progress"], .t-focus .cp-sec[data-sec="tasks"] { border-color:#111; box-shadow:0 10px 30px rgba(0,0,0,.06); }
    .t-focus .cp-sec[data-sec="site"] { border-style:dashed; opacity:.92; }
    .t-focus { color:#111; }
    .t-focus .cp-site-row button { background:#111; color:#fff; }

    /* —— FLOWFIELD: content docked at bottom over full canvas —— */
    .t-flowfield { color:#7ef0c3; }
    .t-flowfield .cp-shell {
      position:relative; z-index:2; min-height:100vh; display:flex; flex-direction:column; justify-content:flex-end;
      padding:0; max-width:none;
    }
    .t-flowfield .cp-dock {
      background:linear-gradient(180deg,transparent,rgba(2,8,6,.92) 28%);
      padding:48px 5vw 100px; display:grid; grid-template-columns:1.1fr .9fr; gap:16px;
    }
    .t-flowfield .cp-dock .cp-sec, .t-flowfield .cp-dock .cp-sec-head {
      background:rgba(5,8,12,.55); border:1px solid rgba(126,240,195,.25); border-radius:16px; padding:16px; backdrop-filter:blur(12px);
    }
    .t-flowfield .cp-site-row button { background:#7ef0c3; color:#04110c; }
    @media(max-width:900px){ .t-flowfield .cp-dock{grid-template-columns:1fr;} }

    /* —— EMBERFLOW: big progress stage + two columns —— */
    .t-emberflow { color:#ff8a4c; }
    .t-emberflow .cp-shell { position:relative; z-index:2; max-width:1100px; margin:0 auto; padding:28px 16px 100px; min-height:100vh; }
    .t-emberflow .cp-hero-pct {
      min-height:42vh; display:flex; flex-direction:column; justify-content:flex-end; padding:24px 8px 8px;
    }
    .t-emberflow .cp-hero-pct .cp-pct { font-size:clamp(4rem,14vw,8rem); color:#ff8a4c; text-shadow:0 0 40px rgba(255,100,40,.35); }
    .t-emberflow .cp-cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .t-emberflow .cp-sec {
      background:rgba(20,8,4,.7); border:1px solid rgba(255,138,76,.28); border-radius:14px; padding:16px; backdrop-filter:blur(10px);
    }
    .t-emberflow .cp-site-row button { background:#ff8a4c; color:#1a0a04; }
    @media(max-width:800px){ .t-emberflow .cp-cols{grid-template-columns:1fr;} }

    /* —— OCEANFLOW: horizontal snap rail —— */
    .t-oceanflow { color:#4fd1ff; }
    .t-oceanflow .cp-shell { position:relative; z-index:2; padding:36px 0 100px; min-height:100vh; max-width:none; }
    .t-oceanflow .cp-shell > .cp-sec-head, .t-oceanflow .cp-shell > .cp-sec[data-sec="site"],
    .t-oceanflow .cp-shell > .cp-sec[data-sec="activity"], .t-oceanflow .cp-shell > .cp-sec[data-sec="docs"] {
      max-width:960px; margin-left:auto; margin-right:auto; padding-left:16px; padding-right:16px;
    }
    .t-oceanflow .cp-rail {
      display:flex; gap:14px; overflow-x:auto; scroll-snap-type:x mandatory; padding:8px 8vw 16px;
      -webkit-overflow-scrolling:touch;
    }
    .t-oceanflow .cp-rail .cp-sec {
      min-width:min(360px,82vw); scroll-snap-align:center;
      background:rgba(2,12,20,.72); border:1px solid rgba(79,209,255,.3); border-radius:20px; padding:18px; backdrop-filter:blur(12px);
    }
    .t-oceanflow .cp-sec {
      background:rgba(2,12,20,.72); border:1px solid rgba(79,209,255,.25); border-radius:16px; padding:16px; margin-bottom:12px; backdrop-filter:blur(10px);
    }
    .t-oceanflow .cp-site-row button { background:#4fd1ff; color:#021018; }

    /* —— SPRINGKIT: 2-col masonry bounce —— */
    .t-springkit { background:linear-gradient(160deg,#eef2ff,#fdf2f8 50%,#ecfeff); color:#111; }
    .t-springkit .cp-shell {
      max-width:980px; margin:0 auto; padding:36px 16px 100px; min-height:100vh;
      columns:2; column-gap:14px;
    }
    .t-springkit .spring-item { break-inside:avoid; margin-bottom:14px; opacity:0; }
    .t-springkit .cp-sec, .t-springkit .cp-sec-head {
      background:#fff; border:1px solid #e0e7ff; border-radius:22px; padding:18px;
      box-shadow:0 14px 40px rgba(37,99,235,.1);
    }
    .t-springkit { color:#2563eb; }
    .t-springkit .cp-site-row input { background:#fff; color:#111; }
    .t-springkit .cp-site-row button { background:#2563eb; color:#fff; }
    @media(max-width:720px){ .t-springkit .cp-shell{columns:1;} }

    /* —— MAGNET: full-screen free board —— */
    .t-magnet { background:#0b1020; color:#f8fafc; }
    .t-magnet .cp-shell {
      min-height:100vh; max-width:none; padding:28px 4vw 100px;
      display:grid; grid-template-columns:repeat(12,1fr); gap:14px; align-content:start;
    }
    .t-magnet .cp-sec, .t-magnet .cp-sec-head {
      background:#12182b; border:1px solid #334155; border-radius:16px; padding:18px; transition:transform .12s linear;
    }
    .t-magnet .cp-sec-head { grid-column:span 7; }
    .t-magnet .cp-sec[data-sec="progress"] { grid-column:span 5; }
    .t-magnet .cp-sec[data-sec="tasks"] { grid-column:span 7; }
    .t-magnet .cp-sec[data-sec="statuses"] { grid-column:span 5; }
    .t-magnet .cp-sec[data-sec="site"] { grid-column:span 12; }
    .t-magnet .cp-sec[data-sec="activity"], .t-magnet .cp-sec[data-sec="docs"] { grid-column:span 6; }
    .t-magnet { color:#a78bfa; }
    .t-magnet .cp-site-row button { background:#a78bfa; color:#0b1020; }
    @media(max-width:800px){
      .t-magnet .cp-sec, .t-magnet .cp-sec-head { grid-column:span 12 !important; }
    }

    /* —— CLIPWIPE —— */
    .t-clipwipe { background:#111; color:#fff; }
    .t-clipwipe .cp-shell { width:100%; min-height:100vh; padding:0 0 80px; }
    .t-clipwipe .wipe {
      clip-path:inset(0 100% 0 0);
      will-change:clip-path;
    }
    .t-clipwipe .wipe.is-shown { clip-path:inset(0 0 0 0); }
    .t-clipwipe .cp-sec, .t-clipwipe .cp-sec-head {
      padding:28px 8vw; border-bottom:1px solid #222; margin:0;
      border-left:6px solid #f43f5e; background:#161616;
    }
    .t-clipwipe { color:#f43f5e; }
    .t-clipwipe .cp-site-row button { background:#f43f5e; color:#111; }

    /* —— PATHDRAW —— */
    .t-pathdraw { background:#07140c; color:#e7fbe9; }
    .t-pathdraw .cp-shell { display:grid; grid-template-columns:320px 1fr; min-height:100vh; }
    .t-pathdraw .cp-left {
      position:sticky; top:0; height:100vh; padding:32px 20px; border-right:1px solid rgba(74,222,128,.25);
      display:flex; flex-direction:column; justify-content:center; background:#0a1c12;
    }
    .t-pathdraw .cp-right { padding:28px 22px 100px; }
    .t-pathdraw .cp-sec { background:rgba(16,40,24,.85); border:1px solid rgba(74,222,128,.25); border-radius:12px; padding:16px; }
    .t-pathdraw { color:#4ade80; }
    .t-pathdraw .path-svg { width:180px; height:180px; }
    .t-pathdraw .cp-site-row button { background:#4ade80; color:#042f2e; }
    @media(max-width:900px){ .t-pathdraw .cp-shell{grid-template-columns:1fr;} .t-pathdraw .cp-left{height:auto; position:relative;} }

    /* —— CASCADE: full-width stacked panels —— */
    .t-cascade { background:#1c140f; color:#fff7ed; }
    .t-cascade .cp-shell { max-width:none; margin:0; padding:0 0 80px; min-height:100vh; }
    .t-cascade .cascade-item { opacity:0; transform:translateY(-40px); }
    .t-cascade .cascade-item .cp-sec, .t-cascade .cascade-item .cp-sec-head {
      background:#2a1d14; border:0; border-bottom:1px solid #78350f; border-radius:0;
      padding:28px min(8vw,80px); margin:0; min-height:28vh; display:flex; flex-direction:column; justify-content:center;
    }
    .t-cascade .cascade-item:nth-child(even) .cp-sec,
    .t-cascade .cascade-item:nth-child(even) .cp-sec-head { background:#241810; }
    .t-cascade { color:#fbbf24; }
    .t-cascade .cp-site-row button { background:#fbbf24; color:#1c140f; }

    /* —— MESHGLOW —— */
    .t-meshglow { color:#f5f3ff; overflow:hidden; }
    .t-meshglow .mesh-bg {
      position:fixed; inset:-25%; z-index:0;
      background:
        radial-gradient(circle at 20% 30%, rgba(56,189,248,.5), transparent 40%),
        radial-gradient(circle at 80% 20%, rgba(244,114,182,.45), transparent 42%),
        radial-gradient(circle at 50% 80%, rgba(167,139,250,.45), transparent 45%), #0a0618;
      animation:meshMove 14s ease-in-out infinite alternate; filter:blur(10px);
    }
    @keyframes meshMove { to { transform:translate(5%,-4%) scale(1.1); } }
    .t-meshglow .cp-shell { position:relative; z-index:2; max-width:860px; margin:0 auto; padding:40px 16px 100px; min-height:100vh; }
    .t-meshglow .cp-sec { background:rgba(20,12,40,.55); border:1px solid rgba(196,181,253,.3); border-radius:20px; padding:18px; backdrop-filter:blur(14px); }
    .t-meshglow .float-card { animation:floatY 5s ease-in-out infinite; }
    .t-meshglow .float-card:nth-child(2n){ animation-delay:.5s; }
    @keyframes floatY { 50%{ transform:translateY(-8px);} }
    .t-meshglow { color:#c4b5fd; }
    .t-meshglow .cp-site-row button { background:#c4b5fd; color:#1e1035; }

    /* —— TICKER —— */
    .t-ticker { background:#020617; color:#d1fae5; font-family:IBM Plex Mono,monospace; }
    .t-ticker .ticker-rail { overflow:hidden; border-block:1px solid #134e4a; background:#042f2e; }
    .t-ticker .ticker-track { display:inline-block; white-space:nowrap; padding:12px 0; animation:tickMove 20s linear infinite; }
    @keyframes tickMove { to { transform:translateX(-50%); } }
    .t-ticker .cp-shell { max-width:900px; margin:0 auto; padding:28px 16px 100px; min-height:calc(100vh - 44px); }
    .t-ticker .cp-sec { background:#0f172a; border:1px solid #115e59; border-radius:4px; padding:16px; }
    .t-ticker { color:#2dd4bf; }
    .t-ticker .cp-site-row button { background:#2dd4bf; color:#042f2e; }
    .t-ticker .type-caret::after { content:'▋'; animation:blink 1s step-end infinite; }
    @keyframes blink { 50%{opacity:0;} }
  `;

  let cssOk = false;
  function injectCss() {
    if (cssOk) return;
    const el = document.createElement('style');
    el.id = 'cp-all-css';
    el.textContent = CSS;
    document.head.appendChild(el);
    cssOk = true;
  }

  /* Flow field canvas */
  function startFlow(canvas, key) {
    const cfg = {
      flowfield: { hueStart: 120, hueRange: 200, sat: 90, light: 62, bg: '5,5,8', trail: 0.06 },
      emberflow: { hueStart: 0, hueRange: 55, sat: 95, light: 58, bg: '8,4,2', trail: 0.07 },
      oceanflow: { hueStart: 180, hueRange: 90, sat: 88, light: 60, bg: '2,6,10', trail: 0.06 }
    }[key];
    if (!cfg || !canvas) return () => {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const dpr = Math.min(devicePixelRatio || 1, 2);
    let w = 0, h = 0, t = 0, id = 0, parts = [];
    const field = (x, y, time) => {
      const s = 0.0025;
      return Math.sin(x * s + time * 0.0007) * Math.PI + Math.cos(y * s + time * 0.0005) * Math.PI;
    };
    const spawn = () => ({
      x: Math.random() * w, y: Math.random() * h, speed: 1.1 + Math.random() * 1.6,
      hue: cfg.hueStart + Math.random() * cfg.hueRange, life: 0, maxLife: 200 + Math.random() * 300
    });
    const resize = () => {
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${cfg.bg})`; ctx.fillRect(0, 0, w, h);
      parts = Array.from({ length: 800 }, spawn);
    };
    const loop = () => {
      t++;
      ctx.fillStyle = `rgba(${cfg.bg},${cfg.trail})`;
      ctx.fillRect(0, 0, w, h);
      for (const p of parts) {
        const a = field(p.x, p.y, t);
        p.x += Math.cos(a) * p.speed; p.y += Math.sin(a) * p.speed; p.life++;
        if (p.life > p.maxLife) Object.assign(p, spawn());
        if (p.x < 0) p.x += w; if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h; if (p.y > h) p.y -= h;
        const pr = p.life / p.maxLife;
        const alpha = Math.min(pr * 8, 1) * Math.min((1 - pr) * 6, 1) * 0.85;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue},${cfg.sat}%,${cfg.light}%,${alpha})`;
        ctx.fill();
      }
      id = requestAnimationFrame(loop);
    };
    resize(); addEventListener('resize', resize); loop();
    return () => { cancelAnimationFrame(id); removeEventListener('resize', resize); };
  }

  const layouts = {
    basic(s) {
      return `<div class="cp-root t-basic"><div class="cp-shell">${stack(s)}</div></div>`;
    },
    neon(s) {
      return `<div class="cp-root t-neon"><div class="cp-shell">
        <div class="cp-left">${s.head}${s.progress}</div>
        <div class="cp-right">${s.site}${s.taskList}${s.statuses}${s.activity}${s.documents}</div>
      </div></div>`;
    },
    nebula(s) {
      return `<div class="cp-root t-nebula"><div class="cp-shell"><div class="cp-bento">
        <div class="span-12">${s.head}</div>
        <div class="span-7">${s.progress}</div>
        <div class="span-5">${s.statuses}</div>
        <div class="span-12">${s.site}</div>
        <div class="span-6">${s.taskList}</div>
        <div class="span-6">${s.activity || s.documents || '<section class="cp-sec"><h2>Лента</h2><p class="cp-muted">Пока пусто</p></section>'}</div>
        ${s.documents && s.activity ? `<div class="span-12">${s.documents}</div>` : (s.documents ? `<div class="span-12">${s.documents}</div>` : '')}
      </div></div></div>`;
    },
    radiant(s) {
      return `<div class="cp-root t-radiant"><div class="cp-shell">
        <div class="cp-main">${s.head}${s.progress}${s.taskList}${s.activity}</div>
        <div class="cp-aside">${s.site}${s.statuses}${s.documents}</div>
      </div></div>`;
    },
    lumen(s) {
      return `<div class="cp-root t-lumen">
        <div class="cp-band">${s.head}</div>
        <div class="cp-shell">${s.progress}${s.site}${s.taskList}${s.statuses}${s.activity}${s.documents}</div>
      </div>`;
    },
    datacore(s) {
      return `<div class="cp-root t-datacore"><div class="cp-shell">
        <nav class="cp-nav">
          <div class="cp-kicker" style="margin-bottom:16px;">Datacore</div>
          <a href="#sec-progress">Готовность</a>
          <a href="#sec-site">Сайт / графики</a>
          <a href="#sec-tasks">Этапы</a>
          <a href="#sec-more">Ещё</a>
          ${s.head}
        </nav>
        <div class="cp-body">
          <div id="sec-progress">${s.progress}</div>
          <div id="sec-site">${s.site}</div>
          <div id="sec-tasks">${s.taskList}</div>
          <div id="sec-more">${s.statuses}${s.activity}${s.documents}</div>
        </div>
      </div></div>`;
    },
    focus(s) {
      return `<div class="cp-root t-focus"><div class="cp-shell">
        ${s.head}${s.progress}${s.taskList}${s.statuses}${s.activity}${s.documents}${s.site}
      </div></div>`;
    },
    flowfield(s) {
      return `<div class="cp-root t-flowfield"><canvas class="cp-canvas" id="p2Canvas"></canvas>
        <div class="cp-shell"><div class="cp-dock">
          <div>${s.head}${s.progress}${s.taskList}</div>
          <div>${s.statuses}${s.site}${s.activity}${s.documents}</div>
        </div></div></div>`;
    },
    emberflow(s) {
      return `<div class="cp-root t-emberflow"><canvas class="cp-canvas" id="p2Canvas"></canvas>
        <div class="cp-shell">
          <div class="cp-hero-pct">${s.head}${s.progress}</div>
          <div class="cp-cols">
            <div>${s.taskList}${s.statuses}</div>
            <div>${s.site}${s.activity}${s.documents}</div>
          </div>
        </div></div>`;
    },
    oceanflow(s) {
      return `<div class="cp-root t-oceanflow"><canvas class="cp-canvas" id="p2Canvas"></canvas>
        <div class="cp-shell">
          ${s.head}
          <div class="cp-rail">${s.progress}${s.taskList}${s.statuses}</div>
          ${s.site}${s.activity}${s.documents}
        </div></div>`;
    },
    springkit(s) {
      const parts = [s.head, s.progress, s.taskList, s.statuses, s.site, s.activity, s.documents].filter(Boolean);
      return `<div class="cp-root t-springkit"><div class="cp-shell">
        ${parts.map(html => `<div class="spring-item">${html}</div>`).join('')}
      </div></div>`;
    },
    magnet(s) {
      return `<div class="cp-root t-magnet"><div class="cp-shell magnet-zone">${stack(s)}</div></div>`;
    },
    clipwipe(s) {
      const parts = [s.head, s.progress, s.site, s.taskList, s.statuses, s.activity, s.documents].filter(Boolean);
      return `<div class="cp-root t-clipwipe"><div class="cp-shell">
        ${parts.map(html => `<div class="wipe">${html}</div>`).join('')}
      </div></div>`;
    },
    pathdraw(s, ctx) {
      const pct = ctx.pct;
      const r = 60, c = 2 * Math.PI * r, off = c - (pct / 100) * c;
      const left = `
        ${s.head}
        <svg class="path-svg" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="8"/>
          <circle id="p2PathRing" cx="70" cy="70" r="${r}" fill="none" stroke="currentColor" stroke-width="8"
            stroke-linecap="round" transform="rotate(-90 70 70)"
            stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${off}"/>
          <text x="70" y="78" text-anchor="middle" fill="currentColor" font-size="26" font-weight="700" id="cpPctNum">${pct}%</text>
        </svg>
        <p class="cp-muted">${ctx.done} из ${ctx.total}</p>`;
      return `<div class="cp-root t-pathdraw"><div class="cp-shell">
        <div class="cp-left">${left}</div>
        <div class="cp-right">${s.progress.replace('id="cpPctNum"', 'id="cpPctNumDup"')}${s.site}${s.taskList}${s.statuses}${s.activity}${s.documents}</div>
      </div></div>`;
    },
    cascade(s) {
      const parts = [s.head, s.progress, s.site, s.taskList, s.statuses, s.activity, s.documents].filter(Boolean);
      return `<div class="cp-root t-cascade"><div class="cp-shell">
        ${parts.map(html => `<div class="cascade-item">${html}</div>`).join('')}
      </div></div>`;
    },
    meshglow(s) {
      const parts = [s.head, s.progress, s.site, s.taskList, s.statuses, s.activity, s.documents].filter(Boolean);
      return `<div class="cp-root t-meshglow"><div class="mesh-bg"></div><div class="cp-shell">
        ${parts.map(html => `<div class="float-card">${html}</div>`).join('')}
      </div></div>`;
    },
    ticker(s, ctx) {
      const names = (ctx.tasks || []).map(t => t.name).concat([ctx.p.name || 'Project']).join('  ·  ');
      const line = esc(names + '  ·  ' + names + '  ·  ');
      return `<div class="cp-root t-ticker">
        <div class="ticker-rail"><div class="ticker-track"><span>${line}</span><span>${line}</span></div></div>
        <div class="cp-shell">
          <h1 class="cp-h1 type-caret" id="p2Title" data-type="${esc(ctx.p.name || 'Проект')}"></h1>
          <p class="cp-lead">${esc(ctx.p.client || '')}</p>
          ${s.progress}${s.site}${s.taskList}${s.statuses}${s.activity}${s.documents}
        </div>
      </div>`;
    }
  };

  let cleanups = [];
  function clearAnims() {
    while (cleanups.length) { try { cleanups.pop()(); } catch (e) {} }
  }

  function animate(theme, root) {
    clearAnims();
    if (!root) return;
    root.querySelectorAll('.fill-anim').forEach(el => {
      const w = el.getAttribute('data-w') || '0';
      if (global.gsap) global.gsap.to(el, { width: w + '%', duration: 1.1, ease: 'power2.out' });
      else el.style.width = w + '%';
    });

    if (theme === 'flowfield' || theme === 'emberflow' || theme === 'oceanflow') {
      cleanups.push(startFlow(root.querySelector('#p2Canvas'), theme));
      return;
    }
    if (theme === 'springkit') {
      root.querySelectorAll('.spring-item').forEach((el, i) => {
        el.animate(
          [{ opacity: 0, transform: 'scale(.88) translateY(20px)' }, { opacity: 1, transform: 'scale(1.03) translateY(-3px)', offset: .72 }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 700, delay: i * 90, easing: 'cubic-bezier(.22,1.4,.36,1)', fill: 'forwards' }
        );
      });
      return;
    }
    if (theme === 'magnet') {
      const cards = root.querySelectorAll('.cp-sec, .cp-sec-head');
      const move = e => {
        cards.forEach(card => {
          const r = card.getBoundingClientRect();
          const dx = (e.clientX - (r.left + r.width / 2)) / 30;
          const dy = (e.clientY - (r.top + r.height / 2)) / 30;
          card.style.transform = `translate(${dx}px,${dy}px)`;
        });
      };
      addEventListener('mousemove', move);
      cleanups.push(() => removeEventListener('mousemove', move));
      return;
    }
    if (theme === 'clipwipe') {
      root.querySelectorAll('.wipe').forEach((el, i) => {
        const run = () => {
          const anim = el.animate(
            [
              { clipPath: 'inset(0 100% 0 0)', WebkitClipPath: 'inset(0 100% 0 0)' },
              { clipPath: 'inset(0 0 0 0)', WebkitClipPath: 'inset(0 0 0 0)' }
            ],
            { duration: 650, delay: 80 + i * 120, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }
          );
          anim.onfinish = () => el.classList.add('is-shown');
          // fallback если Web Animations недоступны / сбились
          setTimeout(() => el.classList.add('is-shown'), 80 + i * 120 + 700);
        };
        run();
      });
      return;
    }
    if (theme === 'pathdraw') {
      const ring = root.querySelector('#p2PathRing');
      if (ring) {
        ring.animate(
          [{ strokeDashoffset: ring.getAttribute('stroke-dasharray') }, { strokeDashoffset: ring.getAttribute('data-target') }],
          { duration: 1400, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
        );
      }
      return;
    }
    if (theme === 'cascade') {
      root.querySelectorAll('.cascade-item').forEach((el, i) => {
        el.animate(
          [{ opacity: 0, transform: 'translateY(-48px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 520, delay: i * 110, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' }
        );
      });
      return;
    }
    if (theme === 'ticker') {
      const title = root.querySelector('#p2Title');
      if (title) {
        const full = title.getAttribute('data-type') || '';
        title.textContent = '';
        let i = 0;
        const id = setInterval(() => {
          title.textContent = full.slice(0, i++);
          if (i > full.length) clearInterval(id);
        }, 40);
        cleanups.push(() => clearInterval(id));
      }
      return;
    }
    if (theme === 'neon' || theme === 'nebula' || theme === 'radiant' || theme === 'lumen' || theme === 'datacore' || theme === 'focus' || theme === 'basic' || theme === 'meshglow') {
      if (global.gsap) {
        const els = root.querySelectorAll('.cp-sec, .cp-sec-head, .cp-band, .cp-left');
        global.gsap.from(els, { opacity: 0, y: 18, duration: 0.55, stagger: 0.05, ease: 'power2.out' });
      }
    }
  }

  function themeFromToken(seed) {
    let h = 0;
    const s = String(seed || 'x');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return THEMES[Math.abs(h) % THEMES.length];
  }

  function render(theme, ctx) {
    injectCss();
    const t = THEMES.includes(theme) ? theme : 'basic';
    const label = LABELS[t] || t;
    const s = sections(Object.assign({}, ctx, { themeLabel: label }));
    const fn = layouts[t] || layouts.basic;
    return fn(s, ctx);
  }

  global.ClientPortalAll = {
    themes: THEMES,
    labels: LABELS,
    render,
    animate,
    clearAnims,
    themeFromToken,
    has: t => THEMES.includes(t)
  };
  // backward compat for old pack2 name
  global.ClientPortalPack2 = {
    themes: THEMES.filter(t => !['basic','neon','nebula','radiant','lumen','datacore','focus'].includes(t)),
    labels: LABELS,
    has: t => global.ClientPortalAll.has(t),
    render: (t, ctx) => global.ClientPortalAll.render(t, ctx),
    animate: (t, root) => global.ClientPortalAll.animate(t, root),
    clearAnims,
    pickForProject: themeFromToken
  };
})(window);
