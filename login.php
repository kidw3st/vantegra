<?php
/** Вход в личный кабинет. */

require __DIR__ . '/inc/boot.php';

// Уже вошёл — незачем показывать форму.
if (current_user()) {
    header('Location: cabinet.php');
    exit;
}

$err = null;
$email = '';
$ip = client_ip();
$locked = recent_fails($ip, (int) $cfg['lock_minutes']) >= (int) $cfg['max_attempts'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim((string) ($_POST['email'] ?? ''));
    $pass  = (string) ($_POST['pass'] ?? '');

    if (!csrf_ok($_POST['csrf'] ?? null)) {
        $err = 'Форма устарела. Обновите страницу и попробуйте снова.';
    } elseif ($locked) {
        $err = 'Слишком много попыток. Подождите ' . (int) $cfg['lock_minutes'] . ' минут.';
    } else {
        $st = db()->prepare('SELECT id, pass_hash FROM users WHERE email = ?');
        $st->execute([$email]);
        $row = $st->fetch();

        // password_verify сам по себе занимает заметное время, поэтому
        // ответ для несуществующей почты выглядит так же, как для неверного пароля.
        $ok = $row && password_verify($pass, $row['pass_hash']);
        log_attempt($ip, $email, $ok);

        if ($ok) {
            // Новый идентификатор сессии — чтобы нельзя было подсунуть заранее известный.
            session_regenerate_id(true);
            $_SESSION['uid'] = (int) $row['id'];

            // Хеш устарел (сменился алгоритм или стоимость) — пересчитываем молча.
            if (password_needs_rehash($row['pass_hash'], PASSWORD_DEFAULT)) {
                $up = db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?');
                $up->execute([password_hash($pass, PASSWORD_DEFAULT), $row['id']]);
            }
            db()->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')
                ->execute([$row['id']]);

            header('Location: cabinet.php');
            exit;
        }

        // Одинаковый текст для обоих случаев: иначе по ответу можно
        // перебором выяснить, какие адреса зарегистрированы.
        $err = 'Неверная почта или пароль.';
        $locked = recent_fails($ip, (int) $cfg['lock_minutes']) >= (int) $cfg['max_attempts'];
    }
}
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вход — Vantegra</title>
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

    <p class="label">Личный кабинет</p>
    <h1 class="gate__title">Вход</h1>

    <?php if ($err): ?>
      <div class="note note--bad"><p><?= e($err) ?></p></div>
    <?php endif; ?>

    <form class="form" method="post" autocomplete="on">
      <input type="hidden" name="csrf" value="<?= e(csrf_token()) ?>">

      <div class="field">
        <label for="email">Почта</label>
        <input id="email" name="email" type="email" required autofocus
               autocomplete="username" value="<?= e($email) ?>">
      </div>

      <div class="field">
        <label for="pass">Пароль</label>
        <input id="pass" name="pass" type="password" required autocomplete="current-password">
      </div>

      <button class="btn btn--solid" type="submit" <?= $locked ? 'disabled' : '' ?>>
        Войти
      </button>
    </form>

    <p class="gate__foot">
      Доступ выдаёт студия. Если не получается войти —
      <a href="contacts.html">напишите нам</a>.
    </p>
  </div>
</main>

</body>
</html>
