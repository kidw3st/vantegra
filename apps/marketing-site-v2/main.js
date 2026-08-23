/* Vantegra v2: шапка, меню, активный раздел, форма. Появления делает CSS. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* бегущая строка: добираем копий до бесшовного цикла */
  const row = $('#marqueeRow');
  if (row && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const set = row.firstElementChild;
    let guard = 0;
    while (row.scrollWidth < innerWidth * 2 && guard++ < 20) row.append(set.cloneNode(true));
    [...row.children].forEach((n) => row.append(n.cloneNode(true)));
  }

  /* мобильное меню */
  const burger = $('.top__burger');
  const drawer = $('#drawer');
  const closeDrawer = () => {
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
  $$('a', drawer).forEach((a) => a.addEventListener('click', closeDrawer));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDrawer(); });

  /* активный раздел в навигации */
  const links = $$('.top__pill a');
  const byId = Object.fromEntries(links.map((a) => [a.hash.slice(1), a]));
  const spy = new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('is-active', a === byId[en.target.id]));
    }
  }, { rootMargin: '-40% 0px -55%' });
  $$('#services, #process, #work, #pricing, #faq').forEach((s) => spy.observe(s));

  /* форма: проверка на месте, отправка без перезагрузки, запасной путь: почта */
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
    const inputs = $$('.field__input', form);
    const bad = inputs.filter((i) => !check(i));
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
      // сервера может не быть на статике: собираем письмо
      const d = new FormData(form);
      location.href = 'mailto:hello@vantegra.ru?subject=' + encodeURIComponent('Заявка с сайта')
        + '&body=' + encodeURIComponent(`Имя: ${d.get('name')}\nКонтакт: ${d.get('contact')}\nЗадача: ${d.get('task')}`);
      btn.disabled = false; btn.textContent = 'Отправить';
    }
  });
})();
