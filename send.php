<?php
/**
 * Приём заявки с формы на contacts.html.
 *
 * Работает в двух режимах:
 *   - fetch со страницы  → отвечает JSON
 *   - обычная отправка формы (когда JS выключен) → рисует страницу с результатом
 *
 * Заявка кладётся в базу и уходит письмом. Если база недоступна,
 * письмо всё равно отправляется — заявку терять нельзя.
 */

require __DIR__ . '/inc/boot.php';

const MAIL_TO = 'hello@vantegra.ru';   // куда падают заявки
const MAIL_FROM = 'noreply@vantegracode.ru';

$wantsJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

/* ---------- разбор и проверка ---------- */

$name    = trim((string) ($_POST['name'] ?? ''));
$contact = trim((string) ($_POST['contact'] ?? ''));
$kind    = trim((string) ($_POST['kind'] ?? ''));
$task    = trim((string) ($_POST['task'] ?? ''));
$trap    = trim((string) ($_POST['website'] ?? ''));   // ловушка для ботов

$errors = [];

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    $errors['form'] = 'Форма отправляется методом POST.';
}
if ($name === '' || mb_strlen($name) > 120) {
    $errors['name'] = 'Напишите, как к вам обращаться.';
}
if ($contact === '' || mb_strlen($contact) > 190) {
    $errors['contact'] = 'Оставьте почту или ник в Telegram — иначе мы не ответим.';
}
if (mb_strlen($task) < 10) {
    $errors['task'] = 'Опишите задачу хотя бы одним предложением.';
}
if (mb_strlen($task) > 5000) {
    $errors['task'] = 'Слишком длинно. Уложитесь в 5000 символов, детали обсудим на созвоне.';
}

$allowed = ['Сайт', 'Телеграм-бот', 'Веб-приложение', 'Мобильная игра', 'Пока не знаю'];
if (!in_array($kind, $allowed, true)) {
    $kind = 'Не указано';
}

// Ловушку заполняют только боты: поле спрятано и человек его не видит.
// Отвечаем «принято», чтобы бот не подбирал обход.
$isBot = $trap !== '';

/* ---------- частота отправки ---------- */

$ip = client_ip();
if (!$errors && !$isBot) {
    try {
        $st = db()->prepare(
            'SELECT COUNT(*) FROM leads WHERE ip = ? AND created_at > (NOW() - INTERVAL 10 MINUTE)'
        );
        $st->execute([$ip]);
        if ((int) $st->fetchColumn() >= 3) {
            $errors['form'] = 'Вы уже отправили несколько заявок. Подождите десять минут или напишите в Telegram.';
        }
    } catch (Throwable $e) {
        // Таблицы ещё нет или база недоступна — не повод терять заявку.
        error_log('leads rate check: ' . $e->getMessage());
    }
}

/* ---------- сохранение и отправка ---------- */

$saved = false;
$mailed = false;

if (!$errors && !$isBot) {
    try {
        $st = db()->prepare(
            'INSERT INTO leads (name, contact, kind, task, ip, ua) VALUES (?, ?, ?, ?, ?, ?)'
        );
        $st->execute([
            $name, $contact, $kind, $task, $ip,
            mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
        ]);
        $saved = true;
    } catch (Throwable $e) {
        error_log('leads insert: ' . $e->getMessage());
    }

    $body = "Заявка с сайта vantegracode.ru\n\n"
          . "Имя:    $name\n"
          . "Связь:  $contact\n"
          . "Задача: $kind\n\n"
          . "$task\n\n"
          . "---\n"
          . 'IP: ' . $ip . "\n"
          . 'Время: ' . date('d.m.Y H:i') . "\n";

    $headers = [
        'From: Vantegra <' . MAIL_FROM . '>',
        'Content-Type: text/plain; charset=UTF-8',
    ];
    // Ответить прямо из почты, если человек оставил адрес.
    if (filter_var($contact, FILTER_VALIDATE_EMAIL)) {
        $headers[] = 'Reply-To: ' . $contact;
    }

    $mailed = @mail(
        MAIL_TO,
        '=?UTF-8?B?' . base64_encode('Заявка с сайта — ' . $kind) . '?=',
        $body,
        implode("\r\n", $headers)
    );

    if (!$saved && !$mailed) {
        $errors['form'] = 'Не получилось принять заявку. Напишите нам напрямую на ' . MAIL_TO;
    }
}

/* ---------- ответ ---------- */

$ok = !$errors;

if ($wantsJson) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($ok ? 200 : 422);
    echo json_encode(['ok' => $ok, 'errors' => $errors], JSON_UNESCAPED_UNICODE);
    exit;
}
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= $ok ? 'Заявка отправлена' : 'Проверьте форму' ?> — Vantegra</title>
<meta name="robots" content="noindex">
<script>(function(){try{var t=localStorage.getItem('vantegra-theme');document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){document.documentElement.dataset.theme='light'}})()</script>
<link rel="icon" href="assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@200;300;500;700&family=Onest:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="styles.css">
</head>
<body>

<main class="gate">
  <div class="gate__card">
    <a class="gate__mark" href="index.html">
      <img src="assets/logo.png" alt="" width="512" height="512">
      <span>Vantegra</span>
    </a>

    <?php if ($ok): ?>
      <h1 class="gate__title">Заявка принята</h1>
      <div class="note note--ok">
        <p>Спасибо, <?= e($name) ?>. Вернёмся с вопросами и оценкой в течение дня.</p>
      </div>
      <a class="btn btn--solid" href="index.html">На главную</a>
    <?php else: ?>
      <h1 class="gate__title">Проверьте форму</h1>
      <div class="note note--bad">
        <?php foreach ($errors as $msg): ?><p><?= e($msg) ?></p><?php endforeach; ?>
      </div>
      <a class="btn btn--solid" href="contacts.html">Вернуться к форме</a>
    <?php endif; ?>
  </div>
</main>

</body>
</html>
