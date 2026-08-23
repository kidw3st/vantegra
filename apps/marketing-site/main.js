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

  /* ============ 7. раскрывающиеся блоки ============ */

  for (const head of $$('.acc__head')) {
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') === 'true';

      // Внутри одной группы открыт только один блок: на длинном списке
      // вопросов иначе приходится много скроллить, чтобы вернуться назад.
      if (!open) {
        const group = head.closest('.acc');
        if (group) {
          for (const other of $$('.acc__head', group)) {
            if (other !== head) other.setAttribute('aria-expanded', 'false');
          }
        }
      }
      head.setAttribute('aria-expanded', open ? 'false' : 'true');
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

  /* ============ 10. маскот: следит за курсором по обеим осям ============ */

  const canvas = $('#sceneCanvas');
  const portal = $('#portal');
  const hero = $('#hero');
  const hint = $('#hint');

  const coarse = matchMedia('(pointer: coarse)').matches;
  if (hint && coarse) hint.textContent = 'Вант · маскот студии';

  if (canvas && portal && hero) {
    // Куда маскот смотрит в каждый момент ролика: x — вправо, y — вниз,
    // длина ~1 на пределе поворота. Клип обходит полный круг направлений:
    // анфас → вниз → влево → вверх → вправо → анфас. Поэтому под любое
    // положение курсора в ролике находится подходящая поза.
    // Разметка ролика mascot.mp4 (10 с) по кадрам: анфас → моргание → взгляд
    // влево → вправо (долго) → влево (долго) → вверх (долго) → вверх-вправо →
    // вправо → вправо-вниз → вниз.
    const GAZE = [
      [ 0.00,  0.00,  0.00], [ 0.75,  0.00,  0.00], [ 0.96,  0.00,  0.00],
      [ 1.00, -0.50,  0.00], [ 1.13, -0.30,  0.00], [ 1.25,  0.70, -0.05],
      [ 1.50,  0.90,  0.00], [ 1.96,  0.90,  0.00], [ 2.22,  0.60,  0.00],
      [ 2.47,  0.30,  0.00], [ 2.59, -0.60,  0.05], [ 2.84, -0.50,  0.00],
      [ 3.01, -0.70, -0.15], [ 3.47, -0.70, -0.15], [ 3.59, -0.70,  0.00],
      [ 3.76, -0.60,  0.00], [ 4.05,  0.40, -0.30], [ 4.14,  0.50, -0.40],
      [ 4.31,  0.00, -0.70], [ 4.47,  0.10, -0.90], [ 4.68, -0.10, -1.00],
      [ 5.22,  0.00, -1.00], [ 5.77,  0.20, -0.95], [ 6.10,  0.10, -0.70],
      [ 6.23,  0.00, -0.40], [ 6.52,  0.60, -0.50], [ 6.94,  0.60, -0.45],
      [ 7.11,  0.50, -0.10], [ 7.36,  0.50,  0.00], [ 7.61,  0.35,  0.00],
      [ 8.11,  0.30,  0.00], [ 8.44,  0.25,  0.00], [ 8.65,  0.50,  0.20],
      [ 9.03,  0.50,  0.45], [ 9.24,  0.50,  0.60], [ 9.45,  0.40,  0.75],
      [ 9.66,  0.20,  0.90], [ 9.86,  0.00,  1.00], [ 9.99,  0.00,  1.00],
    ];
    // Моменты с закрытыми глазами (моргание, прищур, улыбка): как поза
    // не выбираются, но проходятся при довороте, поэтому моргание остаётся.
    const BLINK = [[0.77, 0.94], [3.78, 4.03], [6.25, 6.50], [8.80, 8.97]];

    const N = 240;            // поз в памяти: шаг ~0.04 c видео, практически каждый кадр ролика
    const CROP = 0.5;         // какая доля ширины кадра реально видна в арке
    const BW = 360, BH = 432; // размер кадра в кэше: 240 кадров × 0.6 МБ
    const EASE = 0.18;        // мягкость доводки позы

    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    // слежение только там, где есть настоящий курсор
    const canTrack = !!ctx && !calm.matches && !coarse;

    const frames = [];
    const gaze = [];
    let idx = 0, want = 0, rest = 0;
    let ready = false, visible = true;

    // направление взгляда в момент t — линейно между опорными точками
    function gazeAt(t) {
      for (const [a, b] of BLINK) if (t >= a && t <= b) return [9, 9];
      for (let i = 1; i < GAZE.length; i++) {
        if (t <= GAZE[i][0]) {
          const a = GAZE[i - 1], b = GAZE[i];
          const k = (t - a[0]) / (b[0] - a[0] || 1);
          return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
        }
      }
      return [0, 0];
    }

    // ближайшая поза к нужному направлению
    function nearest(gx, gy) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < gaze.length; i++) {
        const dx = gaze[i][0] - gx, dy = gaze[i][1] - gy;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }

    /* ---- разбор ролика на кадры ---- */

    // Ролик нужен только как источник кадров — на странице его нет
    // и он никогда не проигрывается зрителю. Пока кадры не разобраны,
    // в портале висит статичный кадр анфас.
    function buildCache() {
      const src = document.createElement('video');
      src.src = 'assets/mascot.mp4';
      src.muted = true;
      src.playsInline = true;
      src.preload = 'auto';
      // Колбэки кадров приходят только у видео, которое браузер реально
      // компонует, поэтому элемент висит в документе, но не виден.
      src.setAttribute('aria-hidden', 'true');
      src.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;pointer-events:none';
      document.body.append(src);

      src.addEventListener('loadeddata', () => {
        const vw = src.videoWidth, vh = src.videoHeight;
        const sw = Math.round(vw * CROP), sx = Math.round((vw - sw) / 2);
        const span = (src.duration || 0) - 0.05;
        if (!(span > 0)) return;

        const times = [];
        for (let i = 0; i < N; i++) times.push((i / (N - 1)) * span);
        let next = 0;

        function grab(t) {
          const c = document.createElement('canvas');
          c.width = BW; c.height = BH;
          c.getContext('2d').drawImage(src, sx, 0, sw, vh, 0, 0, BW, BH);
          frames.push(c);
          gaze.push(gazeAt(t));
        }

        function finish() {
          while (next < N) { grab(times[next]); next++; }   // добираем хвост
          src.pause();
          src.src = '';
          src.remove();
          rest = Math.round(0.4 / span * (N - 1));   // поза покоя: спокойный анфас в начале ролика
          idx = want = rest;
          ready = true;
          paintFrame(frames[rest]);
          portal.classList.add('is-canvas');
        }

        // Снимаем кадры на проигрывании: перемотка стоит сотни миллисекунд,
        // а так декодер идёт подряд и отдаёт всё за пару секунд.
        if (src.requestVideoFrameCallback) {
          let ticks = 0, seeking = false;
          const onFrame = (now, meta) => {
            if (seeking) return;
            ticks++;
            while (next < N && meta.mediaTime >= times[next]) { grab(times[next]); next++; }
            if (next < N) src.requestVideoFrameCallback(onFrame);
            else finish();
          };
          // если за секунду не пришло ни одного кадра (фоновая вкладка,
          // особенности браузера), снимаем перемоткой, а не добираем хвост
          const guard = setTimeout(() => {
            if (ticks === 0 && !ready) { seeking = true; src.pause(); bySeeking(); }
          }, 1000);
          src.addEventListener('ended', () => {
            clearTimeout(guard);
            if (seeking || ready) return;
            // кадров пришло мало: остаток честно добираем перемоткой
            if (next < N) { seeking = true; bySeeking(); }
          }, { once: true });
          src.requestVideoFrameCallback(onFrame);
          src.playbackRate = 2;
          src.play().catch(() => { seeking = true; bySeeking(); });
        } else {
          bySeeking();
        }

        // запасной путь для браузеров без requestVideoFrameCallback
        async function bySeeking() {
          const seekTo = (t) => new Promise((r) => {
            const done = () => { src.removeEventListener('seeked', done); r(); };
            src.addEventListener('seeked', done);
            src.currentTime = t;
          });
          while (next < N) { await seekTo(times[next]); grab(times[next]); next++; }
          finish();
        }
      }, { once: true });
    }

    /* ---- отрисовка ---- */

    function fit() {
      const r = portal.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    // вписываем по принципу object-fit: cover
    function cover(sw, sh) {
      const s = Math.max(canvas.width / sw, canvas.height / sh);
      const w = sw * s, h = sh * s;
      return [(canvas.width - w) / 2, (canvas.height - h) / 2, w, h];
    }

    function paintFrame(bmp) {
      fit();
      ctx.drawImage(bmp, ...cover(bmp.width, bmp.height));
    }

    // дробная поза: кадр i целиком, поверх него кадр i+1 с весом доли.
    // Так доворот идёт плавнее шага между кадрами и не зависит от герц экрана.
    function paintAt(pos) {
      const i = Math.floor(pos), f = pos - i;
      const a = frames[((i % N) + N) % N], b = frames[(((i + 1) % N) + N) % N];
      fit();
      const box = cover(a.width, a.height);
      ctx.globalAlpha = 1;
      ctx.drawImage(a, ...box);
      if (f > 0.02) {
        ctx.globalAlpha = f;
        ctx.drawImage(b, ...box);
        ctx.globalAlpha = 1;
      }
    }

    /* ---- курсор ---- */

    if (canTrack) buildCache();

    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.05 }).observe(portal);

    addEventListener('pointermove', (e) => {
      if (!ready) return;

      // маскот следит только на первом экране; ниже смотрит вперёд
      const box = hero.getBoundingClientRect();
      if (e.clientY < box.top || e.clientY > box.bottom) { want = rest; return; }

      // направление от головы к курсору
      const p = portal.getBoundingClientRect();
      const hx = p.left + p.width * 0.5;
      const hy = p.top + p.height * 0.42;
      const reach = Math.max(innerWidth, innerHeight) * 0.42;
      want = nearest(
        clamp((e.clientX - hx) / reach, -1, 1),
        clamp((e.clientY - hy) / reach, -1, 1),
      );

      if (hint && hint.dataset.done !== '1') {
        hint.dataset.done = '1';
        hint.style.opacity = '0';
      }
    }, { passive: true });

    const toRest = () => { want = rest; };
    addEventListener('pointerleave', toRest, { passive: true });
    addEventListener('blur', toRest);

    (function loop() {
      if (ready && visible) {
        // идём к нужной позе по кратчайшей дуге — голова доворачивается,
        // а не прыгает, потому что соседние кадры это соседние повороты
        let d = want - idx;
        if (d > N / 2) d -= N;
        if (d < -N / 2) d += N;
        idx += d * EASE;
        if (idx < 0) idx += N;
        if (idx >= N) idx -= N;
        paintAt(idx);
      }
      requestAnimationFrame(loop);
    })();
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
    const btn = $('button[type="submit"]', form);

    // Свои подсказки вместо браузерных пузырей: они не переводятся
    // и исчезают, стоит отвести взгляд.
    function errorBox(field) {
      let p = $('.field__err', field);
      if (!p) {
        p = document.createElement('p');
        p.className = 'field__err';
        field.append(p);
      }
      return p;
    }

    function showError(input, text) {
      const field = input.closest('.field');
      if (!field) return;
      field.classList.add('is-bad');
      input.setAttribute('aria-invalid', 'true');
      const p = errorBox(field);
      p.textContent = text;
      if (!input.getAttribute('aria-describedby')) {
        p.id = p.id || 'err-' + (input.id || Math.random().toString(36).slice(2));
        input.setAttribute('aria-describedby', p.id);
      }
    }

    function clearError(input) {
      const field = input.closest('.field');
      if (!field) return;
      field.classList.remove('is-bad');
      input.removeAttribute('aria-invalid');
      const p = $('.field__err', field);
      if (p) p.textContent = '';
    }

    // Текст под конкретное нарушение, а не общее «заполните поле».
    function complain(input) {
      const v = input.validity;
      if (v.valueMissing) {
        return input.name === 'task'
          ? 'Опишите задачу — хотя бы одним предложением.'
          : 'Это поле нужно заполнить.';
      }
      if (v.tooShort) return `Слишком коротко: нужно хотя бы ${input.minLength} символов.`;
      if (v.tooLong)  return `Слишком длинно: не больше ${input.maxLength} символов.`;
      return 'Проверьте значение.';
    }

    function validate() {
      let first = null;
      for (const el of form.elements) {
        if (!el.name || el.type === 'submit' || el.name === 'website') continue;
        if (el.checkValidity()) {
          clearError(el);
        } else {
          showError(el, complain(el));
          if (!first) first = el;
        }
      }
      if (first) {
        first.focus();
        first.scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' });
      }
      return !first;
    }

    // Как только человек начал править поле — убираем красноту.
    form.addEventListener('input', (e) => {
      if (e.target.name && e.target.checkValidity()) clearError(e.target);
    });

    function say(kind, text) {
      let box = $('.form__note', form);
      if (!box) {
        box = document.createElement('div');
        box.className = 'form__note';
        box.setAttribute('role', 'status');
        form.append(box);
      }
      box.className = 'form__note note note--' + kind;
      box.innerHTML = '<p></p>';
      box.firstChild.textContent = text;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validate()) {
        say('bad', 'Не все поля заполнены — посмотрите подсказки выше.');
        return;
      }

      const label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'Отправляем…'; }

      try {
        const res = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' },
        });
        const data = await res.json();

        if (data.ok) {
          form.reset();
          say('ok', 'Заявка отправлена. Вернёмся с вопросами и оценкой в течение дня.');
        } else {
          for (const [name, text] of Object.entries(data.errors || {})) {
            const el = form.elements[name];
            if (el) showError(el, text);
          }
          say('bad', data.errors?.form || 'Проверьте отмеченные поля.');
        }
      } catch (err) {
        // Обработчик недоступен (не залит, нет PHP) — не теряем заявку,
        // отдаём человеку запасной путь через почтовый клиент.
        const f = new FormData(form);
        const body = [
          `Имя: ${f.get('name')}`,
          `Связь: ${f.get('contact')}`,
          `Задача: ${f.get('kind')}`,
          '',
          String(f.get('task') || ''),
        ].join('\n');
        say('bad', 'Не получилось отправить с сайта — открываем почтовый клиент.');
        location.href = 'mailto:hello@vantegra.ru'
          + `?subject=${encodeURIComponent('Заявка с сайта — ' + f.get('kind'))}`
          + `&body=${encodeURIComponent(body)}`;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = label; }
      }
    });
  }
})();
