<?php
/**
 * Приём заявки с формы. Без зависимостей: работает на любом PHP 8+.
 *
 * Что делает:
 *   1. проверяет метод, ловушку для ботов и частоту обращений с одного IP;
 *   2. требует согласия на обработку персональных данных (152-ФЗ);
 *   3. пишет заявку и факт согласия в data/leads.jsonl;
 *   4. отправляет письмо; при fetch отвечает JSON, без JS — рисует страницу.
 */

declare(strict_types=1);

const MAIL_TO     = 'hello@vantegra.ru';
const MAIL_FROM   = 'noreply@vantegracode.ru';
const CONSENT_DOC = 'consent v1 (2026-08-24)';
const DATA_DIR    = __DIR__ . '/data';

$wantsJson = str_contains($_SERVER['HTTP_ACCEPT'] ?? '', 'application/json');

function out(int $code, array $payload, bool $json): never
{
    http_response_code($code);
    if ($json) {
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_UNICODE);
        exit;
    }
    $ok = $code === 200;
    $title = $ok ? 'Заявка отправлена' : 'Не получилось отправить';
    $text = $ok
        ? 'Получили. Ответим на почту или в Telegram в течение рабочего дня.'
        : htmlspecialchars(implode(' ', $payload['errors'] ?? ['Попробуйте ещё раз.']), ENT_QUOTES);
    echo <<<HTML
<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>$title — Vantegra</title>
<link rel="stylesheet" href="styles.css"></head><body>
<main id="main" class="lost"><h1 class="display">$title</h1>
<p class="lead">$text</p>
<div class="lost__act"><a class="btn btn--cta" href="./">На главную</a>
<a class="btn btn--ghost" href="contacts">Вернуться к форме</a></div></main></body></html>
HTML;
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    out(405, ['ok' => false, 'errors' => ['Форма отправляется методом POST.']], $wantsJson);
}

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');

/* ловушка для ботов: поле скрыто от людей */
if (trim((string) ($_POST['website'] ?? '')) !== '') {
    out(200, ['ok' => true], $wantsJson);          // ботам отвечаем «успех» молча
}

/* не чаще одной заявки в 30 секунд с одного адреса */
if (!is_dir(DATA_DIR)) {
    @mkdir(DATA_DIR, 0750, true);
}
$stamp = DATA_DIR . '/rate_' . md5($ip) . '.txt';
if (is_file($stamp) && (time() - (int) @filemtime($stamp)) < 30) {
    out(429, ['ok' => false, 'errors' => ['Подождите полминуты и отправьте ещё раз.']], $wantsJson);
}
@touch($stamp);

$name    = trim((string) ($_POST['name'] ?? ''));
$contact = trim((string) ($_POST['contact'] ?? ''));
$kind    = trim((string) ($_POST['kind'] ?? ''));
$task    = trim((string) ($_POST['task'] ?? ''));
$consent = (string) ($_POST['consent'] ?? '') === '1';

$errors = [];
if ($name === '' || mb_strlen($name) > 120) {
    $errors[] = 'Напишите, как к вам обращаться.';
}
if ($contact === '' || mb_strlen($contact) > 190
    || !preg_match('/@|\+?\d[\d\s()-]{5,}/u', $contact)) {
    $errors[] = 'Оставьте почту, ник в Telegram или телефон — иначе мы не ответим.';
}
if (mb_strlen($task) < 10 || mb_strlen($task) > 4000) {
    $errors[] = 'Опишите задачу хотя бы одним предложением.';
}
if (!$consent) {
    $errors[] = 'Нужно согласие на обработку персональных данных.';
}
if ($errors) {
    out(422, ['ok' => false, 'errors' => $errors], $wantsJson);
}

$kinds = ['site' => 'Сайт', 'bot' => 'Телеграм-бот', 'app' => 'Веб-приложение',
          'game' => 'Мобильная игра', 'other' => 'Нужно обсудить'];
$kindName = $kinds[$kind] ?? 'Не указано';

/* журнал: заявка + подтверждение согласия (дата, IP, версия документа) */
$record = [
    'at'         => date('c'),
    'ip'         => $ip,
    'ua'         => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 300),
    'name'       => $name,
    'contact'    => $contact,
    'kind'       => $kindName,
    'task'       => $task,
    'consent'    => true,
    'consentDoc' => CONSENT_DOC,
];
@file_put_contents(DATA_DIR . '/leads.jsonl',
    json_encode($record, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);

/* письмо */
$subject = '=?UTF-8?B?' . base64_encode('Заявка с сайта: ' . $kindName) . '?=';
$body = "Заявка с сайта vantegracode.ru\n\n"
      . "Имя: {$name}\nКонтакт: {$contact}\nНаправление: {$kindName}\n\n"
      . "Задача:\n{$task}\n\n"
      . "Согласие: получено ({$record['consentDoc']})\n"
      . "IP: {$ip}\nВремя: {$record['at']}\n";
$headers = "From: Vantegra <" . MAIL_FROM . ">\r\n"
         . "Reply-To: " . (str_contains($contact, '@') ? $contact : MAIL_TO) . "\r\n"
         . "Content-Type: text/plain; charset=UTF-8\r\n";
@mail(MAIL_TO, $subject, $body, $headers);

out(200, ['ok' => true], $wantsJson);
