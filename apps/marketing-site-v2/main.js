/* Vantegra v2: тема, меню, «наверх», форма. Появления и переходы делает CSS. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  /* ============ аналитика ============
     Одна точка отправки: цель уходит в Яндекс.Метрику (если счётчик подключён)
     и в dataLayer — чтобы позже можно было добавить любой другой сервис
     без правок разметки. Источник визита запоминается по первому касанию
     и уезжает вместе с заявкой, поэтому источник заявки виден даже
     без счётчика — прямо в письме и в журнале на сервере. */

  const track = (goal, params) => {
    try { if (window.ym && window.__YM__) ym(window.__YM__, 'reachGoal', goal, params); } catch {}
    (window.dataLayer = window.dataLayer || []).push({ event: goal, ...params });
  };

  const KEEP = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'yclid', 'gclid', 'from'];
  const firstTouch = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('vantegra-src') || 'null');
      if (saved) return saved;
      const q = new URLSearchParams(location.search);
      const utm = {};
      KEEP.forEach((k) => { const v = q.get(k); if (v) utm[k] = v.slice(0, 80); });
      const data = {
        utm,
        ref: (document.referrer || '').slice(0, 200),
        landing: location.pathname,
        at: new Date().toISOString().slice(0, 16),
      };
      localStorage.setItem('vantegra-src', JSON.stringify(data));
      return data;
    } catch { return { utm: {}, ref: '', landing: location.pathname }; }
  };
  const src = firstTouch();

  /* клики, которые означают интерес: почта, телеграм, телефон, кейс, кабинет */
  addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('mailto:')) track('click_email');
    else if (href.startsWith('tel:')) track('click_phone');
    else if (href.includes('t.me/')) track('click_telegram');
    else if (a.closest('.case')) track('click_case', { url: href });
    else if (href === 'cabinet') track('click_cabinet');
    else if (a.classList.contains('btn--cta')) track('click_cta', { page: location.pathname });
  }, { passive: true });

  /* раскрытие вопроса: показывает, какие возражения реально волнуют */
  $$('.qa').forEach((qa) => qa.addEventListener('toggle', () => {
    if (qa.open) track('faq_open', { q: qa.querySelector('summary')?.textContent?.trim().slice(0, 60) });
  }));

  /* глубина прочтения: одно событие на страницу, без спама */
  if (!calm.matches) {
    let deep = false;
    addEventListener('scroll', () => {
      if (deep) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      if (max > 0 && scrollY / max > 0.75) { deep = true; track('scroll_75', { page: location.pathname }); }
    }, { passive: true });
  }

  /* Тема: выбор пользователя главнее системной.
     Смена идёт круговой волной из самой кнопки — через View Transitions.
     Где API нет (Firefox) или включён щадящий режим, тема меняется мгновенно. */
  const themeBtn = $('#theme');
  if (themeBtn) {
    const root = document.documentElement;
    const apply = (next) => {
      root.dataset.theme = next;
      try { localStorage.setItem('vantegra-theme', next); } catch {}
      track('theme_switch', { to: next });
    };

    themeBtn.addEventListener('click', () => {
      const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
      const cur = root.dataset.theme || (sysDark ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';

      if (!document.startViewTransition || calm.matches) { apply(next); return; }

      // центр волны — центр кнопки, радиус — до самого дальнего угла экрана
      const r = themeBtn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

      root.classList.add('theme-vt');
      const vt = document.startViewTransition(() => apply(next));

      vt.ready.then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
          { duration: 560, easing: 'cubic-bezier(.23, 1, .32, 1)',
            pseudoElement: '::view-transition-new(root)' },
        );
      }).catch(() => {});

      vt.finished.finally(() => root.classList.remove('theme-vt'));
    });
  }

  /* наверх страницы */
  const totop = $('#totop');
  if (totop) {
    const draw = () => totop.classList.toggle('is-on', scrollY > innerHeight * 0.8);
    addEventListener('scroll', draw, { passive: true });
    draw();
    totop.addEventListener('click', () => scrollTo({ top: 0, behavior: calm.matches ? 'auto' : 'smooth' }));
  }

  /* мобильное меню */
  const burger = $('#burger');
  const drawer = $('#drawer');
  if (burger && drawer) {
    const close = () => {
      drawer.hidden = true;
      burger.setAttribute('aria-expanded', 'false');
      document.documentElement.style.overflow = '';
    };
    burger.addEventListener('click', () => {
      const open = drawer.hidden;
      drawer.hidden = !open;
      burger.setAttribute('aria-expanded', String(open));
      document.documentElement.style.overflow = open ? 'hidden' : '';
    });
    $$('a', drawer).forEach((a) => a.addEventListener('click', close));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) close(); });
  }

  /* уведомление о cookie: показываем один раз */
  const cookie = $('#cookie');
  if (cookie) {
    let seen = false;
    try { seen = localStorage.getItem('vantegra-cookie') === '1'; } catch {}
    if (!seen) {
      cookie.hidden = false;
      $('#cookieOk').addEventListener('click', () => {
        cookie.hidden = true;
        try { localStorage.setItem('vantegra-cookie', '1'); } catch {}
      });
    }
  }

  /* форма: проверка на месте, отправка без перезагрузки, запасной путь — почта */
  const form = $('#form');
  if (!form) return;
  const ok = $('.form__ok', form);

  /* источник визита едет вместе с заявкой */
  const fSource = $('#fSource', form);
  const fPage = $('#fPage', form);
  if (fSource) fSource.value = JSON.stringify(src).slice(0, 500);
  if (fPage) fPage.value = location.pathname;

  const need = {
    name: (v) => v.trim().length >= 2 || 'Напишите, как к вам обращаться.',
    contact: (v) => /@|\+?\d{6,}/.test(v.trim()) || 'Нужна почта, @ник или телефон, чтобы ответить.',
    task: (v) => v.trim().length >= 10 || 'Опишите задачу хотя бы одним предложением.',
  };
  const check = (input) => {
    const rule = need[input.name];
    if (!rule) return true;
    const res = rule(input.value);
    const field = input.closest('.field');
    field.classList.toggle('is-bad', res !== true);
    $('.field__err', field).textContent = res === true ? '' : res;
    return res === true;
  };
  $$('.field__input', form).forEach((i) => i.addEventListener('blur', () => check(i)));

  const agree = $('.agree__box', form);
  const agreeErr = $('#consentErr');
  const checkAgree = () => {
    const ok = !agree || agree.checked;
    agree?.closest('.agree')?.classList.toggle('is-bad', !ok);
    if (agreeErr) agreeErr.textContent = ok ? '' : 'Без согласия на обработку данных мы не сможем принять заявку.';
    return ok;
  };
  agree?.addEventListener('change', checkAgree);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bad = $$('.field__input', form).filter((i) => !check(i));
    const agreeOk = checkAgree();
    if (bad.length) { bad[0].focus(); return; }
    if (!agreeOk) { agree.focus(); return; }

    const btn = $('button[type="submit"]', form);
    const d0 = new FormData(form);
    btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      const r = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      form.reset();
      ok.hidden = false;
      btn.textContent = 'Отправлено';
      track('lead_submit', { kind: d0.get('kind'), page: location.pathname });
    } catch {
      track('lead_error', { page: location.pathname });
      const d = new FormData(form);
      location.href = 'mailto:hello@vantegra.ru?subject=' + encodeURIComponent('Заявка с сайта')
        + '&body=' + encodeURIComponent(`Имя: ${d.get('name')}\nКонтакт: ${d.get('contact')}\nЗадача: ${d.get('task')}`);
      btn.disabled = false; btn.textContent = 'Отправить заявку';
    }
  });
})();
