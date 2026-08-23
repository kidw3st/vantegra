<?php
/** Личный кабинет. Без входа сюда не попасть. */
require __DIR__ . '/inc/boot.php';
$me = require_login();

// Инициалы для кружка: первые буквы имени и фамилии, иначе первая буква почты.
$parts = preg_split('/\s+/u', trim((string) $me['name']), -1, PREG_SPLIT_NO_EMPTY);
$ava = $parts
    ? mb_strtoupper(mb_substr($parts[0], 0, 1) . (isset($parts[1]) ? mb_substr($parts[1], 0, 1) : ''))
    : mb_strtoupper(mb_substr($me['email'], 0, 1));
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Личный кабинет — Vantegra</title>
<meta name="description" content="Прототип личного кабинета Vantegra: проекты, задачи, счета и файлы в одном месте.">
<meta name="robots" content="noindex">
<script>(function(){try{var t=localStorage.getItem('vantegra-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme='light'}addEventListener('pagereveal',function(e){if(e.viewTransition)e.viewTransition.finished.catch(function(){})})})()</script>
<link rel="icon" href="assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@200;300;500;700&family=Onest:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="styles.css">
<noscript><style>.reveal,.pop,.fade{opacity:1;transform:none}.line>span,.w>span{transform:none}</style></noscript>
</head>
<body>

<a class="skip" href="#lkMain">К содержимому</a>

<!-- КАРКАС. Данные ниже — заглушки: наполнение подключим позже. -->
<div class="lk">

  <aside class="lk__side">
    <a class="lk__mark" href="index.html">
      <img src="assets/logo.png" alt="" width="512" height="512">
      <span>Vantegra</span>
    </a>

    <nav class="lk__nav" aria-label="Разделы кабинета">
      <button type="button" data-panel="home" data-title="Обзор" aria-current="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-6h5v6"/></svg>
        Обзор
      </button>
      <button type="button" data-panel="projects" data-title="Проекты" aria-current="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17"/></svg>
        Проекты
      </button>
      <button type="button" data-panel="tasks" data-title="Задачи" aria-current="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7.5 6 9.5 9.5 6M4 16.5l2 2 3.5-3.5M13 8h7M13 17h7"/></svg>
        Задачи
      </button>
      <button type="button" data-panel="bills" data-title="Счета" aria-current="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9.5 9h5M9.5 13h5"/></svg>
        Счета
      </button>
      <button type="button" data-panel="files" data-title="Файлы" aria-current="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h3.5l2 2.5H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>
        Файлы
      </button>
      <button type="button" data-panel="settings" data-title="Настройки" aria-current="false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/></svg>
        Настройки
      </button>
    </nav>

    <div class="lk__foot">
      <div class="lk__user">
        <span class="lk__ava" aria-hidden="true"><?= e($ava) ?></span>
        <span class="lk__who">
          <b><?= e($me['name'] !== '' ? $me['name'] : 'Без имени') ?></b>
          <span class="lk__mail"><?= e($me['email']) ?></span>
        </span>
      </div>
      <div class="lk__exit">
        <a class="lk__back" href="index.html">← На сайт</a>
        <a class="lk__back" href="logout.php">Выйти</a>
      </div>
    </div>
  </aside>

  <main class="lk__main" id="lkMain">

    <div class="lk__top">
      <h1 class="lk__title" id="lkTitle">Обзор</h1>
      <span class="badge">Прототип</span>
      <button class="nav__theme" id="theme" type="button" aria-pressed="false" aria-label="Включить тёмную тему">
        <svg class="ico--moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M20 14.6A8.5 8.5 0 1 1 9.4 4a6.7 6.7 0 0 0 10.6 10.6Z"/></svg>
        <svg class="ico--sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/></svg>
      </button>
    </div>

    <!-- ---------- обзор ---------- -->
    <section class="lk__panel is-on" id="p-home" aria-label="Обзор">
      <ul class="tiles">
        <li class="tile pop"><span>Проектов в работе</span><b>2</b></li>
        <li class="tile pop"><span>Задач на вас</span><b>3</b></li>
        <li class="tile pop"><span>Счетов к оплате</span><b>1</b></li>
      </ul>

      <h2 class="steps__name reveal" style="margin-bottom:16px">Последние события</h2>
      <ul class="rows reveal">
        <li>
          <b>Прототип главной страницы готов</b>
          <span class="pill pill--go">Нужен ответ</span>
          <time datetime="2026-08-04">4 августа</time>
        </li>
        <li>
          <b>Согласован состав каталога</b>
          <span class="pill">Закрыто</span>
          <time datetime="2026-08-01">1 августа</time>
        </li>
        <li>
          <b>Выставлен счёт за второй этап</b>
          <span class="pill pill--go">К оплате</span>
          <time datetime="2026-07-29">29 июля</time>
        </li>
        <li>
          <b>Загружены исходники логотипа</b>
          <span class="pill">Файлы</span>
          <time datetime="2026-07-24">24 июля</time>
        </li>
      </ul>
    </section>

    <!-- ---------- проекты ---------- -->
    <section class="lk__panel" id="p-projects" aria-label="Проекты">
      <ul class="rows reveal">
        <li>
          <b>Сайт компании</b>
          <span class="pill pill--go">В работе</span>
          <time>этап 2 из 4</time>
        </li>
        <li>
          <b>Телеграм-бот записи</b>
          <span class="pill pill--go">В работе</span>
          <time>этап 1 из 3</time>
        </li>
        <li>
          <b>Лендинг акции</b>
          <span class="pill">Запущен</span>
          <time>май 2026</time>
        </li>
      </ul>

      <div class="blank reveal" style="margin-top:24px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17M8 14h8"/></svg>
        <h3>Карточка проекта — следующий шаг</h3>
        <p>Внутри будут этапы, сроки, ответственные и лента обсуждения. Сейчас это только каркас.</p>
      </div>
    </section>

    <!-- ---------- остальные разделы ---------- -->
    <section class="lk__panel" id="p-tasks" aria-label="Задачи">
      <div class="blank reveal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 7.5 6 9.5 9.5 6M4 16.5l2 2 3.5-3.5M13 8h7M13 17h7"/></svg>
        <h3>Раздел в разработке</h3>
        <p>Здесь будут задачи, которые ждут вашего решения: согласовать макет, прислать тексты, принять этап.</p>
      </div>
    </section>

    <section class="lk__panel" id="p-bills" aria-label="Счета">
      <div class="blank reveal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2z"/><path d="M9.5 9h5M9.5 13h5"/></svg>
        <h3>Раздел в разработке</h3>
        <p>Здесь будут счета и закрывающие документы: статус оплаты, скачивание, история по этапам.</p>
      </div>
    </section>

    <section class="lk__panel" id="p-files" aria-label="Файлы">
      <div class="blank reveal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h3.5l2 2.5H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/></svg>
        <h3>Раздел в разработке</h3>
        <p>Здесь будут макеты, исходники, доступы и всё, что мы передаём по проекту.</p>
      </div>
    </section>

    <section class="lk__panel" id="p-settings" aria-label="Настройки">
      <div class="blank reveal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/></svg>
        <h3>Раздел в разработке</h3>
        <p>Здесь будут данные компании, реквизиты, участники команды и настройки уведомлений.</p>
      </div>
    </section>

  </main>
</div>

<script src="main.js"></script>
</body>
</html>
