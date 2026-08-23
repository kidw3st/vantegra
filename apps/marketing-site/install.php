<?php
/**
 * Одноразовая установка: создаёт таблицы и первого администратора.
 *
 * ПОСЛЕ УСПЕШНОЙ УСТАНОВКИ УДАЛИТЕ ЭТОТ ФАЙЛ С СЕРВЕРА.
 * Пока он лежит в корне сайта, любой может открыть его и завести себе доступ.
 */

require __DIR__ . '/inc/boot.php';

$done = [];
$err = null;

// Если администратор уже есть — установка закрыта.
try {
    $exists = db()->query("SHOW TABLES LIKE 'users'")->fetchColumn()
        && (int) db()->query("SELECT COUNT(*) FROM users WHERE role='admin'")->fetchColumn() > 0;
} catch (Throwable $e) {
    $exists = false;
}

if ($exists) {
    $err = 'Установка уже выполнена. Удалите install.php с сервера.';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim((string) ($_POST['email'] ?? ''));
    $name  = trim((string) ($_POST['name'] ?? ''));
    $pass  = (string) ($_POST['pass'] ?? '');

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $err = 'Проверьте адрес почты.';
    } elseif (mb_strlen($pass) < 10) {
        $err = 'Пароль должен быть не короче 10 символов.';
    } else {
        try {
            db()->exec(
                "CREATE TABLE IF NOT EXISTS users (
                    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    email      VARCHAR(190) NOT NULL,
                    name       VARCHAR(120) NOT NULL DEFAULT '',
                    pass_hash  VARCHAR(255) NOT NULL,
                    role       ENUM('client','admin') NOT NULL DEFAULT 'client',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME NULL,
                    UNIQUE KEY uniq_email (email)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $done[] = 'Таблица users создана';

            db()->exec(
                "CREATE TABLE IF NOT EXISTS login_attempts (
                    id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    ip    VARCHAR(45) NOT NULL,
                    email VARCHAR(190) NOT NULL DEFAULT '',
                    ok    TINYINT(1) NOT NULL DEFAULT 0,
                    at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_ip (ip, at),
                    KEY idx_email (email, at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $done[] = 'Таблица login_attempts создана';

            db()->exec(
                "CREATE TABLE IF NOT EXISTS leads (
                    id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                    name       VARCHAR(120) NOT NULL,
                    contact    VARCHAR(190) NOT NULL,
                    kind       VARCHAR(60)  NOT NULL DEFAULT '',
                    task       TEXT         NOT NULL,
                    ip         VARCHAR(45)  NOT NULL DEFAULT '',
                    ua         VARCHAR(255) NOT NULL DEFAULT '',
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_ip (ip, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
            );
            $done[] = 'Таблица leads создана';

            $st = db()->prepare(
                'INSERT INTO users (email, name, pass_hash, role) VALUES (?, ?, ?, "admin")'
            );
            // В базу уходит хеш, а не пароль. Обратно его не расшифровать.
            $st->execute([$email, $name, password_hash($pass, PASSWORD_DEFAULT)]);
            $done[] = 'Администратор ' . $email . ' создан';
        } catch (Throwable $e) {
            error_log('install: ' . $e->getMessage());
            $err = 'Не удалось создать таблицы. Проверьте доступы в inc/config.php';
        }
    }
}
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Установка — Vantegra</title>
<meta name="robots" content="noindex">
<link rel="icon" href="assets/favicon.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Unbounded:wght@200;300;700&family=Onest:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="styles.css">
</head>
<body>

<main class="gate">
  <div class="gate__card">
    <h1 class="gate__title">Первый администратор</h1>

    <?php if ($done): ?>
      <div class="note note--ok">
        <?php foreach ($done as $d): ?><p><?= e($d) ?></p><?php endforeach; ?>
        <p><strong>Теперь удалите файл install.php с сервера</strong> — через файловый
           менеджер панели. Пока он на месте, установку может запустить кто угодно.</p>
        <p><a class="more" href="login.php"><u>Перейти ко входу</u></a></p>
      </div>
    <?php elseif ($err): ?>
      <div class="note note--bad"><p><?= e($err) ?></p></div>
    <?php endif; ?>

    <?php if (!$done && !$exists): ?>
    <form class="form" method="post" autocomplete="off">
      <div class="field">
        <label for="name">Имя</label>
        <input id="name" name="name" type="text" required placeholder="Максим">
      </div>
      <div class="field">
        <label for="email">Почта</label>
        <input id="email" name="email" type="email" required placeholder="admin@vantegracode.ru">
      </div>
      <div class="field">
        <label for="pass">Пароль</label>
        <input id="pass" name="pass" type="password" required minlength="10"
               placeholder="Минимум 10 символов">
        <small>Придумайте длинный пароль и сохраните его в менеджере паролей.
               Восстановить его будет нельзя — только задать новый.</small>
      </div>
      <button class="btn btn--solid" type="submit">Создать администратора</button>
    </form>
    <?php endif; ?>
  </div>
</main>

</body>
</html>
