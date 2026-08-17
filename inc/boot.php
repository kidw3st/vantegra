<?php
/**
 * Общая обвязка: конфиг, подключение к базе, сессия, вспомогательные функции.
 * Подключается первой строкой в каждом php-файле сайта.
 */

declare(strict_types=1);

define('APP', true);

$cfg = require __DIR__ . '/config.php';

/* ---------- сессия ---------- */

// Кука сессии: недоступна из JavaScript, не уезжает на чужие домены,
// по HTTPS — только по HTTPS.
$https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
      || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
    'secure'   => $https,
]);
session_name('vantegra_sid');
session_start();

/* ---------- база ---------- */

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    global $cfg;
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $cfg['db_host'], $cfg['db_name']);

    try {
        $pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Настоящие подготовленные запросы, а не подстановка на стороне PHP.
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        // Текст ошибки может содержать доступы — наружу не отдаём.
        error_log('DB: ' . $e->getMessage());
        http_response_code(500);
        exit('База данных недоступна. Проверьте доступы в inc/config.php');
    }

    return $pdo;
}

/* ---------- защита форм ---------- */

function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

function csrf_ok(?string $sent): bool
{
    return is_string($sent)
        && !empty($_SESSION['csrf'])
        && hash_equals($_SESSION['csrf'], $sent);
}

/* ---------- пользователь ---------- */

function current_user(): ?array
{
    if (empty($_SESSION['uid'])) {
        return null;
    }
    static $user = null;
    if ($user === null) {
        $st = db()->prepare('SELECT id, email, name, role FROM users WHERE id = ?');
        $st->execute([$_SESSION['uid']]);
        $user = $st->fetch() ?: false;
    }
    return $user ?: null;
}

function require_login(): array
{
    $u = current_user();
    if (!$u) {
        header('Location: login.php');
        exit;
    }
    return $u;
}

function is_admin(): bool
{
    $u = current_user();
    return $u && $u['role'] === 'admin';
}

/* ---------- мелочи ---------- */

function e(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function client_ip(): string
{
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
}

/** Сколько неудачных попыток входа с этого IP за последние N минут. */
function recent_fails(string $ip, int $minutes): int
{
    // Число минут подставляем в текст запроса: MariaDB не принимает
    // плейсхолдер внутри INTERVAL. Значение приходит из конфига и
    // приведено к int, так что подставлять безопасно.
    $minutes = max(1, $minutes);
    $st = db()->prepare(
        "SELECT COUNT(*) FROM login_attempts
          WHERE ip = ? AND ok = 0 AND at > (NOW() - INTERVAL $minutes MINUTE)"
    );
    $st->execute([$ip]);
    return (int) $st->fetchColumn();
}

function log_attempt(string $ip, string $email, bool $ok): void
{
    $st = db()->prepare('INSERT INTO login_attempts (ip, email, ok) VALUES (?, ?, ?)');
    $st->execute([$ip, mb_substr($email, 0, 190), $ok ? 1 : 0]);
}
