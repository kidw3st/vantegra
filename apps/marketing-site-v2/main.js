/* Vantegra v2: тема, меню, «наверх», форма. Появления и переходы делает CSS. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  /* тема: выбор пользователя главнее системной */
  const themeBtn = $('#theme');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
      const cur = document.documentElement.dataset.theme || (sysDark ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('vantegra-theme', next); } catch {}
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

  /* форма: проверка на месте, отправка без перезагрузки, запасной путь — почта */
  const form = $('#form');
  if (!form) return;
  const ok = $('.form__ok', form);

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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const bad = $$('.field__input', form).filter((i) => !check(i));
    if (bad.length) { bad[0].focus(); return; }

    const btn = $('button[type="submit"]', form);
    btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      const r = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      form.reset();
      ok.hidden = false;
      btn.textContent = 'Отправлено';
    } catch {
      const d = new FormData(form);
      location.href = 'mailto:hello@vantegra.ru?subject=' + encodeURIComponent('Заявка с сайта')
        + '&body=' + encodeURIComponent(`Имя: ${d.get('name')}\nКонтакт: ${d.get('contact')}\nЗадача: ${d.get('task')}`);
      btn.disabled = false; btn.textContent = 'Отправить заявку';
    }
  });
})();
