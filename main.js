/* Vantegra — общий скрипт сайта.
   Никаких библиотек: приёмы взяты у anime.js (каскад по словам, волна от центра,
   отрисовка линии скроллом, пружинный отскок) и собраны на CSS-переходах. */

(() => {
  'use strict';

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Переход между страницами браузер может пропустить — тогда его промис
  // отклоняется. Забираем его на себя, иначе в консоли висит AbortError.
  // (Входящую сторону ловит инлайн-скрипт в <head>, здесь — исходящая.)
  addEventListener('pageswap', (e) => {
    if (e.viewTransition) e.viewTransition.finished.catch(() => {});
  });

  /* ============ 0. тема ============ */

  // Атрибут уже проставлен инлайн-скриптом в <head> — здесь только переключение.
  const themeBtn = document.getElementById('theme');
  if (themeBtn) {
    const sync = () => {
      const dark = document.documentElement.dataset.theme === 'dark';
      themeBtn.setAttribute('aria-pressed', String(dark));
      themeBtn.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
    };
    sync();
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('vantegra-theme', next); } catch (e) { /* приватный режим */ }
      sync();
    });
  }

  /* ============ 1. каскад по словам ============ */

  // Разбиваем заголовок на слова и прячем каждое под свою маску —
  // так строка «набирается», а не выезжает одним куском.
  function splitWords(el) {
    if (el.dataset.split === 'done') return;
    const out = document.createDocumentFragment();
    let n = 0;

    for (const node of [...el.childNodes]) {
      if (node.nodeName === 'BR') { out.append(node); continue; }
      if (node.nodeType !== Node.TEXT_NODE) { out.append(node); continue; }

      for (const chunk of node.textContent.split(/(\s+)/)) {
        if (!chunk) continue;
        if (/^\s+$/.test(chunk)) { out.append(document.createTextNode(' ')); continue; }
        const mask = document.createElement('span');
        mask.className = 'w';
        mask.style.setProperty('--i', n++);
        const inner = document.createElement('span');
        inner.textContent = chunk;
        mask.append(inner);
        out.append(mask);
      }
    }
    el.replaceChildren(out);
    el.dataset.split = 'done';
  }

  $$('[data-split]').forEach(splitWords);

  /* ============ 2. появление по скроллу ============ */

  // Соседи одного родителя выезжают каскадом — индекс задаёт задержку.
  const groups = new Map();
  $$('.reveal, .pop, .fade').forEach((el) => {
    const n = groups.get(el.parentElement) || 0;
    if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', n);
    groups.set(el.parentElement, n + 1);
  });

  const litTargets = $$('[data-split], [data-lines]');
  const inTargets = $$('.reveal, .pop, .fade');

  if (calm.matches || !('IntersectionObserver' in window)) {
    litTargets.forEach((el) => el.classList.add('is-lit'));
    inTargets.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add(e.target.hasAttribute('data-split') || e.target.hasAttribute('data-lines') ? 'is-lit' : 'is-in');
        io.unobserve(e.target);
      }
      // threshold 0: высокие блоки (аккордеоны) иначе не срабатывают,
      // когда в кадр попала только их верхняя полоска
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });

    [...litTargets, ...inTargets].forEach((el) => io.observe(el));
  }

  /* ============ 3. шапка, меню, прогресс ============ */

  const nav = $('#nav');
  const progress = $('#progress');
  const burger = $('#burger');
  const drawer = $('#drawer');

  if (burger && drawer) {
    $$('a', drawer).forEach((a, i) => a.style.setProperty('--i', i));
    const setMenu = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      drawer.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', () => setMenu(burger.getAttribute('aria-expanded') !== 'true'));
    $$('a', drawer).forEach((a) => a.addEventListener('click', () => setMenu(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  }

  /* ============ 4. линии, которые прочерчивает скролл ============ */

  const drawables = $$('[data-draw]');

  /* ============ 5. параллакс декоративных слоёв ============ */

  const floaters = $$('[data-parallax]');

  /* ---- общий цикл скролла: одно чтение геометрии на кадр ---- */

  let queued = false;
  function onScroll() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      const vh = innerHeight;

      if (nav) nav.classList.toggle('is-stuck', y > 24);

      if (progress) {
        const max = document.documentElement.scrollHeight - vh;
        progress.style.setProperty('--p', max > 0 ? clamp(y / max, 0, 1).toFixed(4) : 0);
      }

      if (!calm.matches) {
        for (const svg of drawables) {
          const r = svg.getBoundingClientRect();
          // от «показался снизу» до «поднялся на две трети экрана»:
          // линия успевает дорисоваться и на первом экране, без скролла
          const p = clamp((vh - r.top) / (vh * 0.38), 0, 1);
          svg.style.setProperty('--draw', (1 - p).toFixed(3));
        }
        for (const el of floaters) {
          const speed = Number(el.dataset.parallax) || 0.08;
          const r = el.getBoundingClientRect();
          if (r.bottom < -200 || r.top > vh + 200) continue;
          el.style.setProperty('--lift', ((r.top + r.height / 2 - vh / 2) * -speed).toFixed(1) + 'px');
        }
      }
      queued = false;
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  onScroll();

  /* ============ 6. магнитные кнопки ============ */

  if (!calm.matches && matchMedia('(pointer: fine)').matches) {
    for (const el of $$('[data-magnet]')) {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', clamp((e.clientX - r.left - r.width / 2) * 0.25, -14, 14).toFixed(1) + 'px');
        el.style.setProperty('--my', clamp((e.clientY - r.top - r.height / 2) * 0.3, -10, 10).toFixed(1) + 'px');
      });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--mx', '0px');
        el.style.setProperty('--my', '0px');
      });
    }
  }

  /* ============ 7. раскрывающиеся блоки ============ */

  for (const head of $$('.acc__head')) {
    head.addEventListener('click', () => {
      head.setAttribute('aria-expanded', head.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  }

  /* ============ 8. карточки работ ============ */

  const modal = $('#caseModal');
  if (modal) {
    const body = $('.modal__body', modal);
    for (const btn of $$('.work__btn')) {
      btn.addEventListener('click', () => {
        const detail = $('.work__detail', btn.closest('.work'));
        if (!detail) return;
        body.innerHTML = detail.innerHTML;
        modal.showModal();
      });
    }
    $('#caseClose', modal).addEventListener('click', () => modal.close());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
  }

  /* ============ 8б. фильтр витрины ============ */

  const filters = $('#filters');
  const works = $('#works');
  if (filters && works) {
    const items = $$('.work', works);
    const empty = $('#worksEmpty');

    filters.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-filter]');
      if (!btn) return;

      const pick = btn.dataset.filter;
      $$('button[data-filter]', filters).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));

      let shown = 0;
      for (const el of items) {
        const ok = pick === 'all' || el.dataset.cat === pick;
        el.hidden = !ok;
        if (!ok) continue;
        // пересобираем каскад: видимые карточки снова выезжают по очереди
        el.style.setProperty('--i', shown++);
        el.classList.remove('is-in');
      }
      if (empty) empty.hidden = shown > 0;
      requestAnimationFrame(() => items.forEach((el) => { if (!el.hidden) el.classList.add('is-in'); }));

      // сетка стала короче — иначе страница «уезжает» и человек оказывается в подвале
      const top = filters.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.5) {
        filters.scrollIntoView({ block: 'start', behavior: calm.matches ? 'auto' : 'smooth' });
      }
    });
  }

  /* ============ 9. поле точек: волна от курсора ============ */

  const dots = $('#dots');
  if (dots && !calm.matches) {
    const COLS = 26, ROWS = 8;
    dots.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    dots.style.gridTemplateRows = `repeat(${ROWS}, 1fr)`;
    const cells = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      const d = document.createElement('i');
      dots.append(d);
      cells.push(d);
    }

    // при первом появлении волна расходится от центра — задержка по расстоянию
    const centre = { x: (COLS - 1) / 2, y: (ROWS - 1) / 2 };
    cells.forEach((d, i) => {
      const dx = (i % COLS) - centre.x, dy = ((i / COLS) | 0) - centre.y;
      d.style.transitionDelay = Math.hypot(dx, dy) * 22 + 'ms';
    });
    new IntersectionObserver((entries, obs) => {
      if (!entries[0].isIntersecting) return;
      cells.forEach((d) => d.style.setProperty('--k', '1'));
      setTimeout(() => cells.forEach((d) => { d.style.transitionDelay = ''; d.style.setProperty('--k', '.35'); }), 900);
      obs.disconnect();
    }, { threshold: 0.2 }).observe(dots);

    let pending = false;
    dots.parentElement.addEventListener('pointermove', (e) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        const r = dots.getBoundingClientRect();
        const cw = r.width / COLS, ch = r.height / ROWS;
        cells.forEach((d, i) => {
          const x = r.left + ((i % COLS) + 0.5) * cw;
          const y = r.top + (((i / COLS) | 0) + 0.5) * ch;
          const dist = Math.hypot(e.clientX - x, e.clientY - y);
          d.style.setProperty('--k', (0.35 + clamp(1 - dist / 220, 0, 1) * 1.5).toFixed(2));
        });
        pending = false;
      });
    }, { passive: true });
    dots.parentElement.addEventListener('pointerleave', () => {
      cells.forEach((d) => d.style.setProperty('--k', '.35'));
    }, { passive: true });
  }

  /* ============ 10. маскот: кадр ролика выбирает курсор ============ */

  const video = $('#scene');
  const portal = $('#portal');
  const hero = $('#hero');
  const hint = $('#hint');

  if (hint && matchMedia('(pointer: coarse)').matches) {
    hint.textContent = 'Проведи пальцем — он смотрит';
  }

  if (video && portal && hero) {
    // перемотка кадра стоит ~40-60 мс, поэтому ведём мягко:
    // так невысокая частота обновления не бросается в глаза
    const EASE = 0.1;
    const MIN_STEP = 0.02;
    const IDLE_AFTER = 4000;

    let dur = 0, target = 0.5, cur = 0.5;
    let seeking = false, ready = false, scrubbing = false, visible = true, lastMove = 0;

    const play = () => video.play().catch(() => {});
    const release = () => { if (scrubbing) { scrubbing = false; if (visible) play(); } };

    video.addEventListener('loadedmetadata', () => { dur = video.duration || 0; });
    video.addEventListener('seeked', () => { seeking = false; });
    video.addEventListener('canplay', () => { ready = true; if (!scrubbing) play(); }, { once: true });

    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (!visible) video.pause();
      else if (!scrubbing) play();
    }, { threshold: 0.05 }).observe(portal);

    addEventListener('pointermove', (e) => {
      // маскот слушается курсора только на первом экране; ниже ролик просто играет
      const box = hero.getBoundingClientRect();
      if (e.clientY < box.top || e.clientY > box.bottom) { release(); return; }

      lastMove = performance.now();
      target = clamp(e.clientX / innerWidth, 0, 1);

      if (!scrubbing) {
        scrubbing = true;
        video.pause();
        cur = dur ? video.currentTime / dur : target;
      }
      if (hint && hint.dataset.done !== '1') {
        hint.dataset.done = '1';
        hint.style.opacity = '0';
      }
    }, { passive: true });

    addEventListener('pointerleave', release, { passive: true });
    addEventListener('blur', release);

    (function frame(t) {
      if (scrubbing && !calm.matches && t - lastMove > IDLE_AFTER) release();
      if (visible && scrubbing && ready && dur) {
        cur += (target - cur) * EASE;
        const want = clamp(cur, 0, 1) * (dur - 0.06);
        if (!seeking && Math.abs(want - video.currentTime) > MIN_STEP) {
          seeking = true;
          video.currentTime = want;
        }
      }
      requestAnimationFrame(frame);
    })(0);
  }

  /* ============ 11. бегущая строка ============ */

  const row = $('#tickerRow');
  if (row && !calm.matches) {
    const set = row.firstElementChild;
    // добираем копий, пока лента не станет шире экрана, потом дублируем целиком:
    // сдвиг на -50% тогда возвращает ленту ровно в исходное положение
    let guard = 0;
    while (row.scrollWidth < innerWidth * 2 && guard++ < 20) row.append(set.cloneNode(true));
    [...row.children].forEach((node) => row.append(node.cloneNode(true)));
  }

  /* ============ 11б. кабинет: переключение разделов ============ */

  const lkNav = $('.lk__nav');
  if (lkNav) {
    const title = $('#lkTitle');
    lkNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-panel]');
      if (!btn) return;

      $$('button[data-panel]', lkNav).forEach((b) => b.setAttribute('aria-current', String(b === btn)));
      $$('.lk__panel').forEach((p) => p.classList.toggle('is-on', p.id === 'p-' + btn.dataset.panel));
      if (title) title.textContent = btn.dataset.title || btn.textContent.trim();

      // раздел сменился — прогоняем каскад заново
      $$('#p-' + btn.dataset.panel + ' .pop, #p-' + btn.dataset.panel + ' .reveal').forEach((el, i) => {
        el.classList.remove('is-in');
        el.style.setProperty('--i', i);
      });
      requestAnimationFrame(() => {
        $$('#p-' + btn.dataset.panel + ' .pop, #p-' + btn.dataset.panel + ' .reveal').forEach((el) => el.classList.add('is-in'));
      });
    });
  }

  /* ============ 12. форма — открывает почтовый клиент ============ */

  const form = $('#brief');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const body = [
        `Имя: ${f.get('name') || '—'}`,
        `Связь: ${f.get('contact') || '—'}`,
        `Задача: ${f.get('kind') || '—'}`,
        '',
        String(f.get('task') || ''),
      ].join('\n');
      location.href = `mailto:hello@vantegra.ru?subject=${encodeURIComponent('Заявка с сайта — ' + (f.get('kind') || 'проект'))}&body=${encodeURIComponent(body)}`;
    });
  }
})();
