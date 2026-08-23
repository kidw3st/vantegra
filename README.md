# Vantegra

Монорепозиторий студии: публичный сайт, CRM для команды, клиентский портал
и инфраструктура. Подробный план развития — в файле
«Vantegra — целевая архитектура и план миграции.md».

## Что где

| Папка | Что это | Как запустить |
|---|---|---|
| `apps/marketing-site` | Сайт vantegracode.ru (статика + PHP для кабинета и заявок) | `node apps/marketing-site/server.js` → http://localhost:5173 |
| `apps/marketing-site-v2` | Вторая версия дизайна сайта (черновик, один лендинг) | статика, открыть `index.html` через любой сервер |
| `apps/core-api` | Node/Express API. Без `DATABASE_URL` работает на SQLite; раздаёт CRM и портал | `cd apps/core-api && npm install && node seed.js && node server.js` → http://localhost:3005 |
| `apps/staff-web` | CRM для сотрудников (Vanilla JS) | открывается через core-api: http://localhost:3005/pages/login.html |
| `apps/client-portal` | Кабинет клиента по токен-ссылке | через core-api |
| `apps/worker` | Фоновые задачи (нужен Redis) | `node apps/worker/index.js` |
| `infra/` | nginx, docker-compose, Postgres, systemd, cron, бэкапы | см. `infra/docker-compose.yml` |
| `packages/ui-kit` | Общие токены дизайна | подключается как зависимость |

## Локальная разработка

Сайт и CRM живут на разных портах и не мешают друг другу:

```bash
node apps/marketing-site/server.js     # сайт, :5173
node apps/core-api/server.js           # API + CRM + портал, :3005
```

Учётные записи CRM создаются автоматически при первом запуске, если таблица
пользователей пуста — см. `apps/core-api/database.js`. **Перед продом их нужно
сменить.** Демо-данные: `node apps/core-api/seed.js` (`--reset` — пересоздать).

Форма заявки на сайте дублирует лид в CRM, адрес задаётся в
`apps/marketing-site/inc/config.php` ключом `crm_leads_url`.

## Публикация

- **GitHub Pages** публикует только `apps/marketing-site` (см. `.github/workflows/pages.yml`).
  В настройках репозитория источник Pages должен быть **GitHub Actions**.
- **Боевой сервер** — по `infra/nginx/vantegracode.ru.conf` и `infra/systemd/crm.service`.

## Что не попадает в git

`node_modules`, базы `*.db`, `.env`, `.vault-key`, `uploads/`,
`apps/marketing-site/inc/config.php` (в репозитории только `config.sample.php`).
