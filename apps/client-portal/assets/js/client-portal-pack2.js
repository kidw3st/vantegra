/**
 * Client portal — pack 2 (10 themes)
 * Inspired by: MotionSites, KokonutUI Flow Field, Motion.dev springs
 * Each theme has a unique layout + unique animation (no shared entrance style).
 */
(function (global) {
  const THEMES = [
    'flowfield', 'emberflow', 'oceanflow', 'springkit', 'magnet',
    'clipwipe', 'pathdraw', 'cascade', 'meshglow', 'ticker'
  ];
  const LABELS = {
    flowfield: 'Flow Field',
    emberflow: 'Ember Flow',
    oceanflow: 'Ocean Flow',
    springkit: 'Spring Kit',
    magnet: 'Magnet',
    clipwipe: 'Clip Wipe',
    pathdraw: 'Path Draw',
    cascade: 'Cascade',
    meshglow: 'Mesh Glow',
    ticker: 'Ticker'
  };

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function chartBars(items, getCount, tag, onClass) {
    const max = Math.max(1, ...items.map(getCount));
    return items.map(it => {
      const c = getCount(it);
      const h = c ? Math.max(8, Math.round((c / max) * 100)) : 3;
      return `<${tag} class="${c ? onClass : ''}" style="height:${h}%"></${tag}>`;
    }).join('');
  }

  function siteBlock(ctx, h, cls) {
    const { siteUrl, showVisits, visits, visitsTotal, weeks } = ctx;
    return `
      <section class="${cls}">
        <h2>Сайт · заходы · графики</h2>
        <div class="p2-site-row">
          <input id="cpSiteUrl" placeholder="https://ваш-сайт.ru" value="${esc(siteUrl)}">
          <button type="button" id="cpSiteSave">Сохранить</button>
        </div>
        <div id="cpSiteMsg" class="p2-msg"></div>
        <div id="cpSiteCurrent" class="p2-muted">${siteUrl
          ? 'Сейчас: <a href="' + esc(siteUrl) + '" target="_blank" rel="noopener">' + esc(siteUrl) + '</a>'
          : 'Сайт ещё не указан'}</div>
        ${showVisits ? `
          <div class="p2-charts">
            <div>
              <div class="p2-muted">Заходы 30д · ${visitsTotal}</div>
              <div class="p2-chart">${chartBars(visits, v => v.count, 'i', 'on')}</div>
            </div>
            <div>
              <div class="p2-muted">По неделям</div>
              <div class="p2-chart">${chartBars(weeks, w => w.count, 'i', 'on')}</div>
            </div>
          </div>` : '<p class="p2-muted">Статистика выключена</p>'}
      </section>`;
  }

  function tasksList(tasks, h) {
    if (!tasks.length) return '<p class="p2-muted">Нет этапов</p>';
    return tasks.map(t => `
      <div class="p2-task ${t.done ? 'done' : ''}">
        <span class="p2-mark">${t.done ? '✓' : ''}</span>
        <div><b>${esc(t.name)}</b><small>${esc(t.status)}</small></div>
      </div>`).join('');
  }

  const CSS = `
    .p2-root { position:relative; min-height:100vh; z-index:1; }
    .p2-canvas { position:fixed; inset:0; z-index:0; pointer-events:none; }
    .p2-wrap { position:relative; z-index:2; max-width:880px; margin:0 auto; padding:36px 18px 110px; }
    .p2-kicker { font-size:11px; letter-spacing:.16em; text-transform:uppercase; opacity:.7; margin-bottom:8px; }
    .p2-title { margin:0 0 8px; line-height:1.1; }
    .p2-sub { opacity:.65; margin:0 0 22px; }
    .p2-card, .p2-panel {
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.12);
      border-radius:18px; padding:18px; margin-bottom:12px; backdrop-filter:blur(12px);
    }
    .p2-card h2, .p2-panel h2 { margin:0 0 12px; font-size:13px; letter-spacing:.1em; text-transform:uppercase; opacity:.75; }
    .p2-pct { font-size:clamp(3rem,10vw,5rem); font-weight:800; line-height:1; margin:0 0 8px; }
    .p2-bar { height:8px; background:rgba(255,255,255,.1); border-radius:99px; overflow:hidden; }
    .p2-bar > i { display:block; height:100%; width:0; background:currentColor; border-radius:99px; }
    .p2-site-row { display:flex; gap:8px; margin-bottom:8px; }
    .p2-site-row input {
      flex:1; height:44px; border-radius:12px; border:1px solid rgba(255,255,255,.2);
      background:rgba(0,0,0,.25); color:inherit; padding:0 12px; font:inherit;
    }
    .p2-site-row button {
      height:44px; border:0; border-radius:12px; padding:0 16px; font-weight:700; cursor:pointer;
      background:#fff; color:#111;
    }
    .p2-msg { min-height:1.2em; font-size:13px; }
    .p2-muted { font-size:13px; opacity:.65; margin:6px 0; }
    .p2-charts { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
    .p2-chart { display:flex; align-items:flex-end; gap:2px; height:72px; }
    .p2-chart i { flex:1; display:block; background:rgba(255,255,255,.15); border-radius:2px 2px 0 0; }
    .p2-chart i.on { background:currentColor; opacity:.9; }
    .p2-task { display:flex; gap:10px; padding:10px 0; border-bottom:1px solid rgba(255,255,255,.08); }
    .p2-task:last-child { border-bottom:0; }
    .p2-task.done { opacity:.55; }
    .p2-task b { display:block; }
    .p2-task small { opacity:.6; }
    .p2-mark {
      width:22px; height:22px; border-radius:50%; border:1px solid rgba(255,255,255,.35);
      display:grid; place-items:center; font-size:11px; flex-shrink:0; margin-top:2px;
    }
    .p2-grid2 { display:grid; grid-template-columns:1.2fr .8fr; gap:12px; }
    @media (max-width:720px) {
      .p2-charts, .p2-grid2 { grid-template-columns:1fr; }
      .p2-site-row { flex-direction:column; }
    }

    /* 1 Flow Field */
    .theme-flowfield { font-family:Outfit,system-ui,sans-serif; color:#eafff7; }
    .theme-flowfield .p2-title { font-family:Syne,sans-serif; font-size:clamp(2.4rem,7vw,3.8rem); }
    .theme-flowfield .p2-pct, .theme-flowfield { color:#7ef0c3; }
    .theme-flowfield .p2-card { background:rgba(5,8,12,.55); }

    /* 2 Ember */
    .theme-emberflow { font-family:Syne,system-ui,sans-serif; color:#ffe8d6; }
    .theme-emberflow .p2-wrap { max-width:720px; padding-top:18vh; }
    .theme-emberflow .p2-card { border-radius:24px 24px 8px 8px; background:rgba(20,8,4,.7); border-color:rgba(255,120,60,.25); }
    .theme-emberflow { color:#ff8a4c; }

    /* 3 Ocean */
    .theme-oceanflow { font-family:IBM Plex Sans,system-ui,sans-serif; color:#dff6ff; }
    .theme-oceanflow .p2-hscroll { display:flex; gap:12px; overflow-x:auto; padding-bottom:8px; scroll-snap-type:x mandatory; }
    .theme-oceanflow .p2-hscroll > * { min-width:280px; scroll-snap-align:start; }
    .theme-oceanflow { color:#4fd1ff; }

    /* 4 Spring Kit */
    .theme-springkit { font-family:Outfit,system-ui,sans-serif; color:#111; background:#f4f6fb; }
    .theme-springkit .p2-card {
      background:#fff; border:1px solid #e5e7eb; color:#111; box-shadow:0 10px 30px rgba(0,0,0,.06);
    }
    .theme-springkit .p2-site-row input { background:#fff; color:#111; border-color:#d1d5db; }
    .theme-springkit .p2-site-row button { background:#111; color:#fff; }
    .theme-springkit { color:#2563eb; }
    .theme-springkit .p2-title { color:#111; }
    .theme-springkit .spring-item { transform:scale(.92); opacity:0; }

    /* 5 Magnet */
    .theme-magnet { font-family:Space Grotesk,system-ui,sans-serif; color:#f8fafc; background:#0b1020; }
    .theme-magnet .p2-card { background:#12182b; border-color:#334155; transition:transform .15s linear; }
    .theme-magnet { color:#a78bfa; }

    /* 6 Clip Wipe */
    .theme-clipwipe { font-family:Syne,system-ui,sans-serif; color:#fff; background:#111; }
    .theme-clipwipe .wipe { clip-path: inset(0 100% 0 0); }
    .theme-clipwipe .p2-card { border-radius:0; border-left:4px solid #f43f5e; background:#1a1a1a; }
    .theme-clipwipe { color:#f43f5e; }

    /* 7 Path Draw */
    .theme-pathdraw { font-family:IBM Plex Sans,system-ui,sans-serif; color:#e7fbe9; background:#07140c; }
    .theme-pathdraw .p2-card { background:rgba(16,40,24,.85); border-color:rgba(74,222,128,.25); }
    .theme-pathdraw { color:#4ade80; }
    .theme-pathdraw .path-svg { width:140px; height:140px; display:block; margin:8px 0 12px; }

    /* 8 Cascade */
    .theme-cascade { font-family:Outfit,system-ui,sans-serif; color:#fff7ed; background:#1c140f; }
    .theme-cascade .cascade-item { opacity:0; transform:translateY(-40px); }
    .theme-cascade .p2-card { background:#2a1d14; border-color:#78350f; border-radius:12px; }
    .theme-cascade { color:#fbbf24; }

    /* 9 Mesh Glow */
    .theme-meshglow { font-family:Syne,system-ui,sans-serif; color:#f5f3ff; overflow:hidden; }
    .theme-meshglow .mesh-bg {
      position:fixed; inset:-20%; z-index:0;
      background:
        radial-gradient(circle at 20% 30%, rgba(56,189,248,.45), transparent 40%),
        radial-gradient(circle at 80% 20%, rgba(244,114,182,.4), transparent 42%),
        radial-gradient(circle at 50% 80%, rgba(167,139,250,.4), transparent 45%),
        #0a0618;
      animation: meshMove 14s ease-in-out infinite alternate;
      filter:blur(8px);
    }
    @keyframes meshMove {
      to { transform:translate(4%, -3%) scale(1.08); }
    }
    .theme-meshglow .float-card { animation: floatY 5s ease-in-out infinite; }
    .theme-meshglow .float-card:nth-child(2) { animation-delay:.4s; }
    .theme-meshglow .float-card:nth-child(3) { animation-delay:.8s; }
    @keyframes floatY {
      0%,100% { transform:translateY(0); }
      50% { transform:translateY(-8px); }
    }
    .theme-meshglow { color:#c4b5fd; }

    /* 10 Ticker */
    .theme-ticker { font-family:IBM Plex Mono,monospace; color:#d1fae5; background:#020617; }
    .theme-ticker .ticker-rail {
      overflow:hidden; border-block:1px solid #134e4a; background:#042f2e; margin-bottom:18px;
    }
    .theme-ticker .ticker-track {
      display:inline-block; white-space:nowrap; padding:10px 0;
      animation: tickMove 18s linear infinite;
    }
    @keyframes tickMove { to { transform:translateX(-50%); } }
    .theme-ticker .type-caret::after {
      content:'▋'; margin-left:2px; animation: blink 1s step-end infinite;
    }
    @keyframes blink { 50% { opacity:0; } }
    .theme-ticker .p2-card { border-radius:4px; background:#0f172a; border-color:#115e59; }
    .theme-ticker { color:#2dd4bf; }
  `;

  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    const el = document.createElement('style');
    el.id = 'cp-pack2-styles';
    el.textContent = CSS;
    document.head.appendChild(el);
    stylesInjected = true;
  }

  /* ---- Flow field canvas (KokonutUI-inspired) ---- */
  function startFlowField(canvas, themeKey) {
    const cfg = {
      flowfield: { hueStart: 120, hueRange: 200, sat: 90, light: 62, bg: '5,5,8', trail: 0.06 },
      emberflow: { hueStart: 0, hueRange: 55, sat: 95, light: 58, bg: '8,4,2', trail: 0.07 },
      oceanflow: { hueStart: 180, hueRange: 90, sat: 88, light: 60, bg: '2,6,10', trail: 0.06 }
    }[themeKey];
    if (!cfg || !canvas) return () => {};
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, time = 0, anim = 0;
    const count = 900;
    let particles = [];
    const field = (x, y, t) => {
      const s = 0.0025;
      return Math.sin(x * s + t * 0.0007) * Math.PI
        + Math.cos(y * s + t * 0.0005) * Math.PI
        + Math.sin((x + y) * s * 0.6 + t * 0.0009) * Math.PI * 0.6;
    };
    const spawn = () => {
      const maxLife = 200 + Math.floor(Math.random() * 300);
      return {
        x: Math.random() * w, y: Math.random() * h,
        speed: 1.1 + Math.random() * 1.6,
        hue: cfg.hueStart + Math.random() * cfg.hueRange,
        life: Math.floor(Math.random() * maxLife), maxLife
      };
    };
    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${cfg.bg})`;
      ctx.fillRect(0, 0, w, h);
      particles = Array.from({ length: count }, spawn);
    };
    const render = () => {
      time++;
      ctx.fillStyle = `rgba(${cfg.bg},${cfg.trail})`;
      ctx.fillRect(0, 0, w, h);
      for (const p of particles) {
        const angle = field(p.x, p.y, time);
        p.x += Math.cos(angle) * p.speed;
        p.y += Math.sin(angle) * p.speed;
        p.life++;
        if (p.life > p.maxLife) { Object.assign(p, spawn()); continue; }
        if (p.x < 0) p.x += w; else if (p.x > w) p.x -= w;
        if (p.y < 0) p.y += h; else if (p.y > h) p.y -= h;
        const progress = p.life / p.maxLife;
        const alpha = Math.min(progress * 8, 1) * Math.min((1 - progress) * 6, 1) * 0.85;
        const hue = (p.hue + (angle / (Math.PI * 2)) * 70 + 360) % 360;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue},${cfg.sat}%,${cfg.light}%,${alpha})`;
        ctx.fill();
      }
      anim = requestAnimationFrame(render);
    };
    resize();
    window.addEventListener('resize', resize);
    render();
    return () => {
      cancelAnimationFrame(anim);
      window.removeEventListener('resize', resize);
    };
  }

  function shell(theme, body, withCanvas) {
    return `
      <div class="p2-root theme-${theme}" data-p2-theme="${theme}">
        ${withCanvas ? '<canvas class="p2-canvas" id="p2Canvas"></canvas>' : ''}
        ${theme === 'meshglow' ? '<div class="mesh-bg" aria-hidden="true"></div>' : ''}
        <div class="p2-wrap">${body}</div>
      </div>`;
  }

  function commonHead(ctx, label) {
    const p = ctx.p;
    return `
      <div class="p2-kicker">${esc(label)}${ctx.isPreview ? ' · preview' : ''}</div>
      <h1 class="p2-title" id="p2Title">${esc(p.name || 'Проект')}</h1>
      <p class="p2-sub">${esc(p.client || '')}${p.status ? ' · ' + esc(p.status) : ''}${p.deadline ? ' · до ' + esc(p.deadline) : ''}</p>`;
  }

  function progressCard(ctx, extraClass) {
    return `
      <section class="p2-card ${extraClass || ''}">
        <h2>Готовность</h2>
        <div class="p2-pct" id="cpPctNum">${ctx.pct}%</div>
        <div class="p2-muted">${ctx.done} из ${ctx.total} этапов</div>
        <div class="p2-bar"><i class="fill-anim" data-w="${ctx.pct}"></i></div>
      </section>`;
  }

  const renders = {
    flowfield(ctx, h) {
      return shell('flowfield', `
        ${commonHead(ctx, LABELS.flowfield)}
        ${progressCard(ctx)}
        <section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section>
        ${siteBlock(ctx, h, 'p2-card')}
      `, true);
    },
    emberflow(ctx, h) {
      return shell('emberflow', `
        ${commonHead(ctx, LABELS.emberflow)}
        <div class="p2-grid2">
          ${progressCard(ctx)}
          <section class="p2-card"><h2>Статусы</h2>
            ${(ctx.byStatus || []).map(s => `<div class="p2-task"><span class="p2-mark">${s.count}</span><div><b>${esc(s.name)}</b></div></div>`).join('') || '<p class="p2-muted">—</p>'}
          </section>
        </div>
        <section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section>
        ${siteBlock(ctx, h, 'p2-card')}
      `, true);
    },
    oceanflow(ctx, h) {
      return shell('oceanflow', `
        ${commonHead(ctx, LABELS.oceanflow)}
        <div class="p2-hscroll">
          ${progressCard(ctx)}
          <section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks.slice(0, 6), h)}</section>
          <section class="p2-card"><h2>Ещё</h2>${tasksList(ctx.tasks.slice(6), h) || '<p class="p2-muted">Все этапы слева</p>'}</section>
        </div>
        ${siteBlock(ctx, h, 'p2-card')}
      `, true);
    },
    springkit(ctx, h) {
      return shell('springkit', `
        ${commonHead(ctx, LABELS.springkit)}
        <div class="spring-item">${progressCard(ctx)}</div>
        <div class="spring-item"><section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section></div>
        <div class="spring-item">${siteBlock(ctx, h, 'p2-card')}</div>
      `, false);
    },
    magnet(ctx, h) {
      return shell('magnet', `
        ${commonHead(ctx, LABELS.magnet)}
        <div class="magnet-zone">
          ${progressCard(ctx, 'magnet-card')}
          <section class="p2-card magnet-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section>
          ${siteBlock(ctx, h, 'p2-card magnet-card')}
        </div>
      `, false);
    },
    clipwipe(ctx, h) {
      return shell('clipwipe', `
        <div class="wipe">${commonHead(ctx, LABELS.clipwipe)}</div>
        <div class="wipe">${progressCard(ctx)}</div>
        <div class="wipe"><section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section></div>
        <div class="wipe">${siteBlock(ctx, h, 'p2-card')}</div>
      `, false);
    },
    pathdraw(ctx, h) {
      const pct = ctx.pct;
      const r = 54, c = 2 * Math.PI * r;
      const off = c - (pct / 100) * c;
      return shell('pathdraw', `
        ${commonHead(ctx, LABELS.pathdraw)}
        <section class="p2-card">
          <h2>Готовность</h2>
          <svg class="path-svg" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="${r}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="8"/>
            <circle id="p2PathRing" cx="60" cy="60" r="${r}" fill="none" stroke="currentColor" stroke-width="8"
              stroke-linecap="round" transform="rotate(-90 60 60)"
              stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${off}"/>
            <text x="60" y="66" text-anchor="middle" fill="currentColor" font-size="22" font-weight="700" id="cpPctNum">${pct}%</text>
          </svg>
          <div class="p2-muted">${ctx.done} из ${ctx.total}</div>
          <div class="p2-bar"><i class="fill-anim" data-w="${pct}"></i></div>
        </section>
        <section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section>
        ${siteBlock(ctx, h, 'p2-card')}
      `, false);
    },
    cascade(ctx, h) {
      return shell('cascade', `
        <div class="cascade-item">${commonHead(ctx, LABELS.cascade)}</div>
        <div class="cascade-item">${progressCard(ctx)}</div>
        <div class="cascade-item"><section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section></div>
        <div class="cascade-item">${siteBlock(ctx, h, 'p2-card')}</div>
      `, false);
    },
    meshglow(ctx, h) {
      return shell('meshglow', `
        ${commonHead(ctx, LABELS.meshglow)}
        <div class="float-card">${progressCard(ctx)}</div>
        <div class="float-card"><section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section></div>
        <div class="float-card">${siteBlock(ctx, h, 'p2-card')}</div>
      `, false);
    },
    ticker(ctx, h) {
      const line = (ctx.tasks || []).map(t => t.name).concat([ctx.p.name || 'Project', 'Client portal']).join('  ·  ');
      const doubled = esc(line + '  ·  ' + line + '  ·  ');
      return shell('ticker', `
        <div class="ticker-rail"><div class="ticker-track"><span>${doubled}</span><span>${doubled}</span></div></div>
        <h1 class="p2-title type-caret" id="p2Title" data-type="${esc(ctx.p.name || 'Проект')}"></h1>
        <p class="p2-sub">${esc(ctx.p.client || '')}${ctx.isPreview ? ' · preview' : ''}</p>
        ${progressCard(ctx)}
        <section class="p2-card"><h2>Этапы</h2>${tasksList(ctx.tasks, h)}</section>
        ${siteBlock(ctx, h, 'p2-card')}
      `, false);
    }
  };

  const cleanups = [];
  function clearAnims() {
    while (cleanups.length) {
      try { cleanups.pop()(); } catch (e) {}
    }
  }

  function animate(theme, root) {
    clearAnims();
    if (!root) return;

    // bars
    root.querySelectorAll('.fill-anim').forEach(el => {
      const w = el.getAttribute('data-w') || '0';
      if (global.gsap) global.gsap.to(el, { width: w + '%', duration: 1.1, ease: 'power2.out' });
      else el.style.width = w + '%';
    });

    if (theme === 'flowfield' || theme === 'emberflow' || theme === 'oceanflow') {
      const canvas = root.querySelector('#p2Canvas');
      cleanups.push(startFlowField(canvas, theme));
      if (global.gsap) {
        global.gsap.from(root.querySelectorAll('.p2-card'), {
          opacity: 0, y: 30, duration: 0.9, stagger: 0.12, ease: 'power3.out', delay: 0.2
        });
      }
      return;
    }

    if (theme === 'springkit') {
      const items = root.querySelectorAll('.spring-item');
      // CSS spring-like overshoot via WAAPI
      items.forEach((el, i) => {
        el.animate(
          [
            { opacity: 0, transform: 'scale(0.86) translateY(24px)' },
            { opacity: 1, transform: 'scale(1.04) translateY(-4px)', offset: 0.7 },
            { opacity: 1, transform: 'scale(1) translateY(0)' }
          ],
          { duration: 700, delay: i * 120, easing: 'cubic-bezier(0.22, 1.4, 0.36, 1)', fill: 'forwards' }
        );
      });
      return;
    }

    if (theme === 'magnet') {
      const cards = root.querySelectorAll('.magnet-card');
      const onMove = (e) => {
        cards.forEach(card => {
          const r = card.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = (e.clientX - cx) / 28;
          const dy = (e.clientY - cy) / 28;
          card.style.transform = `translate(${dx}px, ${dy}px)`;
        });
      };
      const onLeave = () => cards.forEach(c => { c.style.transform = 'translate(0,0)'; });
      window.addEventListener('mousemove', onMove);
      cleanups.push(() => window.removeEventListener('mousemove', onMove));
      root.addEventListener('mouseleave', onLeave);
      return;
    }

    if (theme === 'clipwipe') {
      const wipes = root.querySelectorAll('.wipe');
      wipes.forEach((el, i) => {
        el.animate(
          [
            { clipPath: 'inset(0 100% 0 0)' },
            { clipPath: 'inset(0 0% 0 0)' }
          ],
          { duration: 700, delay: 150 + i * 160, easing: 'cubic-bezier(0.65,0,0.35,1)', fill: 'forwards' }
        );
      });
      return;
    }

    if (theme === 'pathdraw') {
      const ring = root.querySelector('#p2PathRing');
      if (ring) {
        const target = ring.getAttribute('data-target');
        ring.animate(
          [
            { strokeDashoffset: ring.getAttribute('stroke-dasharray') },
            { strokeDashoffset: target }
          ],
          { duration: 1400, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' }
        );
      }
      return;
    }

    if (theme === 'cascade') {
      const items = root.querySelectorAll('.cascade-item');
      items.forEach((el, i) => {
        el.animate(
          [
            { opacity: 0, transform: 'translateY(-48px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { duration: 550, delay: i * 140, easing: 'cubic-bezier(0.16,1,0.3,1)', fill: 'forwards' }
        );
      });
      return;
    }

    if (theme === 'meshglow') {
      // CSS handles mesh + float; soft fade-in only
      root.querySelectorAll('.float-card').forEach((el, i) => {
        el.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 900, delay: i * 180, fill: 'forwards' }
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
          title.textContent = full.slice(0, i);
          i++;
          if (i > full.length) clearInterval(id);
        }, 45);
        cleanups.push(() => clearInterval(id));
      }
      return;
    }
  }

  function pickForProject(seed) {
    let h = 0;
    const s = String(seed || 'x');
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return THEMES[Math.abs(h) % THEMES.length];
  }

  function render(theme, ctx, helpers) {
    injectStyles();
    const h = helpers || { esc, actLabel: (a) => a.details || a.action, fmtWhen: () => '' };
    const fn = renders[theme];
    if (!fn) return '';
    return fn(ctx, h);
  }

  global.ClientPortalPack2 = {
    themes: THEMES,
    labels: LABELS,
    injectStyles,
    render,
    animate,
    clearAnims,
    pickForProject,
    has(theme) { return THEMES.includes(theme); }
  };
})(window);
