/**
 * Seed script — заполняет базу тестовыми данными.
 * Запуск: node seed.js
 * Перезапуск: node seed.js --reset (очищает таблицы перед заполнением)
 */
const db = require('./database');

const isReset = process.argv.includes('--reset');

if (isReset) {
    console.log('Очистка таблиц...');
    db.exec('DELETE FROM activity');
    db.exec('DELETE FROM subtasks');
    db.exec('DELETE FROM tasks');
    db.exec('DELETE FROM documents');
    db.exec('DELETE FROM calls');
    db.exec('DELETE FROM reminders');
    db.exec('DELETE FROM salaries');
    db.exec('DELETE FROM expenses');
    db.exec('DELETE FROM projects');
}

// Проверяем, есть ли уже данные
const count = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
if (count > 0 && !isReset) {
    console.log(`В базе уже ${count} проектов. Используйте --reset для перезаписи.`);
    process.exit(0);
}

const projects = [
    {
        id: 'petrov', name: 'Авито бот', client: 'ИП Петров', phone: '+7 900 111-22-33',
        amount: 85000, status: 'В работе', urgent: 1, deadline: '25.07.2026', progress: 62,
        pay_status: 'unpaid', pay_method: 'По счёту', discount: 'yes', discount_val: '10%',
        adequacy: 'good', source: 'Авито', description: 'Бот для автоматических ответов на Авито.',
        hashtags: JSON.stringify(['#бот', '#авито', '#telegram'])
    },
    {
        id: 'romashka', name: 'Корпоративный сайт', client: 'ООО Ромашка', phone: '+7 900 222-33-44',
        amount: 150000, status: 'Переговоры', urgent: 0, deadline: '01.08.2026', progress: 10,
        pay_status: 'pending', pay_method: 'По счёту', discount: 'yes', discount_val: '5%',
        adequacy: 'good', source: 'Знакомые', description: 'Корпоративный сайт на WordPress.',
        hashtags: JSON.stringify(['#wordpress', '#сайт'])
    },
    {
        id: 'mayak', name: 'Контекстная реклама', client: 'Студия Маяк', phone: '+7 900 333-44-55',
        amount: 45000, status: 'В работе', urgent: 0, deadline: '30.07.2026', progress: 40,
        pay_status: 'paid', pay_method: 'Наличные', discount: 'no', discount_val: '',
        adequacy: 'good', source: 'Реклама', description: 'Настройка Яндекс.Директ.',
        hashtags: JSON.stringify(['#реклама', '#директ'])
    },
    {
        id: 'tehno', name: 'Telegram бот', client: 'ООО ТехноСервис', phone: '+7 900 444-55-66',
        amount: 60000, status: 'В работе', urgent: 0, deadline: '28.07.2026', progress: 55,
        pay_status: 'paid', pay_method: 'По счёту', discount: 'maybe', discount_val: '',
        adequacy: 'good', source: 'Telegram', description: 'Telegram-бот для записи клиентов.',
        hashtags: JSON.stringify(['#бот', '#telegram'])
    },
    {
        id: 'kuznetsov', name: 'SEO аудит', client: 'ИП Кузнецов', phone: '+7 900 555-66-77',
        amount: 25000, status: 'В работе', urgent: 0, deadline: '26.07.2026', progress: 30,
        pay_status: 'pending', pay_method: 'Наличные', discount: 'no', discount_val: '',
        adequacy: 'warn', source: 'Авито', description: 'SEO-аудит сайта.',
        hashtags: JSON.stringify(['#seo', '#аудит'])
    },
    {
        id: 'sidorov', name: 'SEO продвижение', client: 'ИП Сидоров', phone: '+7 900 666-77-88',
        amount: 30000, status: 'Абонемент', urgent: 0, deadline: 'Каждый месяц', progress: 100,
        pay_status: 'unpaid', pay_method: 'По счёту', discount: 'no', discount_val: '',
        adequacy: 'good', source: 'Знакомые', description: 'Ежемесячное SEO-продвижение.',
        hashtags: JSON.stringify(['#seo', '#абонемент'])
    },
    {
        id: 'barista', name: 'Лендинг кофейни', client: 'ИП Бариста', phone: '+7 900 777-88-99',
        amount: 50000, status: 'Новый', urgent: 0, deadline: '10.08.2026', progress: 0,
        pay_status: 'unpaid', pay_method: 'Наличные', discount: 'maybe', discount_val: '',
        adequacy: 'good', source: 'Сайт', description: 'Лендинг для кофейни.',
        hashtags: JSON.stringify(['#wordpress', '#лендинг'])
    },
    {
        id: 'style', name: 'Интернет-магазин', client: 'ООО Стиль', phone: '+7 900 888-99-00',
        amount: 200000, status: 'Новый', urgent: 0, deadline: '15.09.2026', progress: 0,
        pay_status: 'unpaid', pay_method: 'По счёту', discount: 'no', discount_val: '',
        adequacy: 'warn', source: 'Реклама', description: 'Интернет-магазин на WordPress.',
        hashtags: JSON.stringify(['#wordpress', '#seo'])
    },
    {
        id: 'xyz', name: 'Мобильное приложение', client: 'Стартап XYZ', phone: '+7 900 999-00-11',
        amount: 350000, status: 'Переговоры', urgent: 0, deadline: '01.10.2026', progress: 5,
        pay_status: 'unpaid', pay_method: 'Рассрочка', discount: 'no', discount_val: '',
        adequacy: 'bad', source: 'Telegram', description: 'Мобильное приложение + Telegram-бот.',
        hashtags: JSON.stringify(['#бот', '#telegram'])
    },
    {
        id: 'avto', name: 'Настройка Авито', client: 'ООО АвтоДеталь', phone: '+7 900 000-11-22',
        amount: 20000, status: 'Выполнено', urgent: 0, deadline: 'Выполнено', progress: 100,
        pay_status: 'paid', pay_method: 'Наличные', discount: 'no', discount_val: '',
        adequacy: 'good', source: 'Авито', description: 'Настройка объявлений на Авито.',
        hashtags: JSON.stringify(['#авито'])
    },
    {
        id: 'masterov', name: 'Сайт-визитка', client: 'ИП Мастеров', phone: '+7 900 111-22-44',
        amount: 40000, status: 'Выполнено', urgent: 0, deadline: 'Выполнено', progress: 100,
        pay_status: 'paid', pay_method: 'Наличные', discount: 'no', discount_val: '',
        adequacy: 'good', source: 'Знакомые', description: 'Сайт-визитка на WordPress.',
        hashtags: JSON.stringify(['#wordpress', '#визитка'])
    },
    {
        id: 'vesta', name: 'Поддержка сайта', client: 'ООО Веста', phone: '+7 900 222-33-55',
        amount: 15000, status: 'Абонемент', urgent: 0, deadline: 'Каждый месяц', progress: 100,
        pay_status: 'paid', pay_method: 'По счёту', discount: 'no', discount_val: '',
        adequacy: 'good', source: 'Сайт', description: 'Ежемесячная поддержка сайта.',
        hashtags: JSON.stringify(['#wordpress', '#поддержка'])
    },
];

const tasks = [
    { id: 't1', project_id: 'petrov', name: 'Настроить webhook', column_status: 'Готово', person: 'Админ Иван', date: '2026-07-20', date_end: '2026-07-20', time: '09:00', done: 1, urgent: 0, hashtags: JSON.stringify(['#бот']), parent_id: null, priority: 'medium', description: 'Подключить webhook от Авито к боту' },
    { id: 't2', project_id: 'petrov', name: 'Логика ответов', column_status: 'Готово', person: 'Админ Иван', date: '2026-07-20', date_end: '2026-07-20', time: '14:00', done: 1, urgent: 0, hashtags: JSON.stringify(['#бот', '#авито']), parent_id: null, priority: 'medium', description: 'Реализовать автоматические ответы на типовые вопросы' },
    { id: 't3', project_id: 'petrov', name: 'Интеграция с CRM', column_status: 'В работе', person: 'Админ Иван', date: '2026-07-28', date_end: '2026-07-30', time: '10:00', done: 0, urgent: 1, hashtags: JSON.stringify(['#бот', '#авито', '#crm']), parent_id: null, priority: 'high', description: 'Связать бота с CRM для автоматического создания лидов' },
    { id: 't4', project_id: 'petrov', name: 'Тестирование', column_status: 'Согласуем', person: 'Менеджер А', date: '2026-07-29', date_end: '2026-07-29', time: '14:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#тест']), parent_id: null, priority: 'low', description: 'Провести полное тестирование всех сценариев' },
    { id: 't5', project_id: 'petrov', name: 'Деплой и передача', column_status: 'Ожидает', person: 'Админ Иван', date: '2026-07-30', date_end: '2026-07-30', time: '12:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#деплой', '#авито']), parent_id: null, priority: 'high', description: 'Развернуть на продакшене и передать клиенту' },
    { id: 't3a', project_id: 'petrov', name: 'Настроить API-эндпоинты', column_status: 'В работе', person: 'Админ Иван', date: '2026-07-28', date_end: '2026-07-28', time: '11:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#api']), parent_id: 't3', priority: 'medium', description: 'Создать REST API для обмена данными с ботом' },
    { id: 't3b', project_id: 'petrov', name: 'Написать тесты', column_status: 'Ожидает', person: 'Админ Иван', date: '2026-07-29', date_end: '2026-07-29', time: '10:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#тест']), parent_id: 't3', priority: 'low', description: 'Unit-тесты для API эндпоинтов' },
    { id: 't6', project_id: 'romashka', name: 'Согласовать макет', column_status: 'В работе', person: 'Менеджер А', date: '2026-07-28', date_end: '2026-07-28', time: '14:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#wordpress', '#дизайн']), parent_id: null, priority: 'medium', description: 'Отправить макет на согласование клиенту' },
    { id: 't7', project_id: 'romashka', name: 'Верстка главной', column_status: 'Ожидает', person: 'Админ Иван', date: '2026-07-30', date_end: '2026-08-01', time: '10:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#wordpress']), parent_id: null, priority: 'medium', description: 'Сверстать главную страницу по утверждённому макету' },
    { id: 't8', project_id: 'mayak', name: 'Подбор ключей', column_status: 'Готово', person: 'Админ Иван', date: '2026-07-18', date_end: '2026-07-18', time: '10:00', done: 1, urgent: 0, hashtags: JSON.stringify(['#ключи']), parent_id: null, priority: 'low', description: 'Собрать семантическое ядро для рекламной кампании' },
    { id: 't9', project_id: 'mayak', name: 'Запустить рекламу', column_status: 'В работе', person: 'Админ Иван', date: '2026-07-28', date_end: '2026-07-29', time: '16:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#реклама', '#директ']), parent_id: null, priority: 'high', description: 'Настроить и запустить кампании в Яндекс.Директ' },
    { id: 't10', project_id: 'tehno', name: 'Бот-заготовка', column_status: 'Готово', person: 'Админ Иван', date: '2026-07-15', date_end: '2026-07-15', time: '09:00', done: 1, urgent: 0, hashtags: JSON.stringify(['#бот']), parent_id: null, priority: 'medium', description: 'Создать базовый шаблон Telegram-бота' },
    { id: 't11', project_id: 'tehno', name: 'Уведомления', column_status: 'В работе', person: 'Админ Иван', date: '2026-07-29', date_end: '2026-07-29', time: '11:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#бот', '#telegram']), parent_id: null, priority: 'medium', description: 'Настроить push-уведомления для клиентов' },
    { id: 't12', project_id: 'kuznetsov', name: 'Аудит сайта', column_status: 'В работе', person: 'Админ Иван', date: '2026-07-28', date_end: '2026-07-30', time: '10:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#seo']), parent_id: null, priority: 'high', description: 'Провести полный SEO-аудит и подготовить рекомендации' },
    { id: 't13', project_id: 'sidorov', name: 'Отчёт по SEO', column_status: 'В работе', person: 'Админ Иван', date: '2026-07-28', date_end: '2026-07-28', time: '09:00', done: 0, urgent: 0, hashtags: JSON.stringify(['#отчёт', '#seo']), parent_id: null, priority: 'medium', description: 'Подготовить ежемесячный отчёт по позициям и трафику' },
];

const kanbanColumns = [
    { name: 'Новый', color: 'blue', sort_order: 0 },
    { name: 'Переговоры', color: 'yellow', sort_order: 1 },
    { name: 'В работе', color: 'green', sort_order: 2 },
    { name: 'Абонемент', color: 'blue', sort_order: 3 },
    { name: 'Выполнено', color: 'gray', sort_order: 4 },
];

const taskColumns = [
    { name: 'Ожидает', color: 'gray', sort_order: 0 },
    { name: 'В работе', color: 'green', sort_order: 1 },
    { name: 'Простой', color: 'yellow', sort_order: 2 },
    { name: 'Согласуем', color: 'yellow', sort_order: 3 },
    { name: 'Готово', color: 'gray', sort_order: 4 },
];

const insertProject = db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, client, phone, amount, status, urgent, deadline, progress, pay_status, pay_method, discount, discount_val, adequacy, source, description, hashtags)
    VALUES (@id, @name, @client, @phone, @amount, @status, @urgent, @deadline, @progress, @pay_status, @pay_method, @discount, @discount_val, @adequacy, @source, @description, @hashtags)
`);

const insertTask = db.prepare(`
    INSERT OR REPLACE INTO tasks (id, project_id, name, column_status, person, date, date_end, time, done, urgent, hashtags, parent_id, priority, description)
    VALUES (@id, @project_id, @name, @column_status, @person, @date, @date_end, @time, @done, @urgent, @hashtags, @parent_id, @priority, @description)
`);

const insertColumn = db.prepare(`
    INSERT OR IGNORE INTO kanban_columns (name, color, sort_order)
    VALUES (@name, @color, @sort_order)
`);

const insertTaskColumn = db.prepare(`
    INSERT OR IGNORE INTO task_columns (name, color, sort_order)
    VALUES (@name, @color, @sort_order)
`);

const insertMany = db.transaction(() => {
    for (const p of projects) insertProject.run(p);
    for (const t of tasks) insertTask.run(t);
    for (const c of kanbanColumns) insertColumn.run(c);
    for (const c of taskColumns) insertTaskColumn.run(c);
});

insertMany();
console.log(`Заполнено: ${projects.length} проектов, ${tasks.length} задач, ${kanbanColumns.length} колонок проектов, ${taskColumns.length} статусов задач.`);
