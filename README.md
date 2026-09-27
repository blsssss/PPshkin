<p align="center">
  <a href="https://max.ru/t516_hakaton_max_bot">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.svg">
      <img src="docs/assets/banner-light.svg" width="100%" alt="ППшкин: что поесть рядом под остаток калорий. Бот и мини-приложение в MAX для кафе, кофеен и пекарен Казани">
    </picture>
  </a>
</p>

<p align="center">
  <b>Дневник питания по фото и подбор блюда рядом под остаток калорий.</b><br>
  Чат-бот и мини-приложение в MAX для небольших кафе, кофеен и пекарен Казани и их гостей.
</p>

<p align="center">
  <a href="https://max.ru/t516_hakaton_max_bot"><img src="https://img.shields.io/badge/%D0%9E%D1%82%D0%BA%D1%80%D1%8B%D1%82%D1%8C_%D0%B1%D0%BE%D1%82%D0%B0_%D0%B2_MAX-6e1aff?style=for-the-badge" alt="Открыть бота в MAX"></a>
  <a href="https://max.ru/t516_hakaton_max_bot?startapp"><img src="https://img.shields.io/badge/%D0%9C%D0%B8%D0%BD%D0%B8--%D0%BF%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D0%B5-7dedf7?style=for-the-badge" alt="Мини-приложение"></a>
  <a href="https://hackathon.easymythic.dev/docs"><img src="https://img.shields.io/badge/Swagger_UI-ff3785?style=for-the-badge" alt="Swagger UI"></a>
</p>

<p align="center">
  <a href="https://github.com/blsssss/PPshkin/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/blsssss/PPshkin/ci.yml?branch=main&style=flat-square&label=ci&logo=githubactions&logoColor=white" alt="ci"></a>
  <a href="https://hackathon.easymythic.dev/ready"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhackathon.easymythic.dev%2Fready&style=flat-square&label=%D0%BF%D1%80%D0%BE%D0%B4&up_message=%D1%80%D0%B0%D0%B1%D0%BE%D1%82%D0%B0%D0%B5%D1%82&down_message=%D0%BD%D0%B5%D0%B4%D0%BE%D1%81%D1%82%D1%83%D0%BF%D0%B5%D0%BD&up_color=6e1aff" alt="прод"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/blsssss/PPshkin?style=flat-square&color=6e1aff" alt="MIT"></a>
  <br>
  <img src="https://img.shields.io/badge/Node-24-6e1aff?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node 24">
  <img src="https://img.shields.io/badge/TypeScript-6-6e1aff?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 6">
  <img src="https://img.shields.io/badge/Fastify-5-6e1aff?style=flat-square&logo=fastify&logoColor=white" alt="Fastify 5">
  <img src="https://img.shields.io/badge/React-19-6e1aff?style=flat-square&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/PostgreSQL-18-6e1aff?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 18">
  <img src="https://img.shields.io/badge/Docker-compose-6e1aff?style=flat-square&logo=docker&logoColor=white" alt="Docker Compose">
</p>

<p align="center">
  <a href="#быстрый-запуск"><b>Быстрый&nbsp;запуск</b></a> ·
  <a href="#сценарий-проверки"><b>Сценарий&nbsp;проверки</b></a> ·
  <a href="docs/architecture.md"><b>Архитектура</b></a> ·
  <a href="docs/product.md"><b>Продукт</b></a> ·
  <a href="docs/deploy.md"><b>Развёртывание</b></a>
</p>

<p align="center">
  <img src="docs/screenshots/03-diary-mobile.png" width="190" alt="Дневник за сегодня: остаток до ориентира, БЖУ и приёмы пищи">
  <img src="docs/screenshots/04-recommendations-mobile.png" width="190" alt="Что поесть: блюдо рядом под остаток калорий и объяснение выбора">
  <img src="docs/screenshots/05-venue-mobile.png" width="190" alt="Карточка кофейни с горящими позициями и кнопкой брони">
  <img src="docs/screenshots/06-booking-qr-mobile.png" width="190" alt="Бронь: код, таймер и QR для кассы">
  <br>
  <sub><b>ГОСТЬ</b>: дневник по фото · подбор рядом · горящее в заведении · бронь с QR</sub>
</p>

<p align="center">
  <img src="docs/screenshots/07-menu-import-mobile.png" width="190" alt="Разбор меню: найденные позиции с ценой и калориями перед добавлением">
  <img src="docs/screenshots/08-deal-form-mobile.png" width="190" alt="Новое горящее предложение: количество, скидка и срок">
  <img src="docs/screenshots/09-redeem-mobile.png" width="190" alt="Бронь погашена: позиция, цена и код, кнопка сканировать следующую">
  <img src="docs/screenshots/10-analytics-mobile.png" width="190" alt="Статистика заведения: выручка, брони и показы">
  <br>
  <sub><b>ЗАВЕДЕНИЕ</b>: импорт меню · горящее предложение · погашение брони · статистика</sub>
</p>

| Что | Где |
|---|---|
| Бот в MAX | [https://max.ru/t516_hakaton_max_bot](https://max.ru/t516_hakaton_max_bot) («Хакатон МАХ 516») |
| Мини-приложение | кнопка запуска в чате с ботом и [https://max.ru/t516_hakaton_max_bot?startapp](https://max.ru/t516_hakaton_max_bot?startapp) |
| API | `https://hackathon.easymythic.dev/api/v1`, Swagger UI [https://hackathon.easymythic.dev/docs](https://hackathon.easymythic.dev/docs), проверки `/health` и `/ready` |
| Мониторинг | публичный дашборд Grafana [https://hackathon.easymythic.dev/grafana/](https://hackathon.easymythic.dev/grafana/) |
| Контракт API | [openapi.yaml](openapi.yaml) (OpenAPI 3.1), проверки для жюри [DATA-API.yaml](DATA-API.yaml) |
| Документы | [архитектура](docs/architecture.md), [сценарии проверки](docs/scenario.md), [продукт](docs/product.md), [политика обработки данных](docs/privacy.md), [пользовательское соглашение](docs/terms.md), [возможности MAX](docs/max-features.md), [развёртывание](docs/deploy.md), [живые проверки](docs/smoke.md) |

<details>
<summary><b>Содержание</b></summary>

- [Назначение](#назначение)
- [Основной сценарий](#основной-сценарий)
- [Состав и архитектура](#состав-и-архитектура)
- [Быстрый запуск](#быстрый-запуск)
- [Требования к окружению](#требования-к-окружению)
- [Переменные окружения](#переменные-окружения)
- [Порты](#порты)
- [Зависимости](#зависимости)
- [Внешние сервисы и интеграции](#внешние-сервисы-и-интеграции)
- [Работа с данными](#работа-с-данными)
- [Тестовые данные](#тестовые-данные)
- [Сценарий проверки](#сценарий-проверки)
- [Примеры ожидаемого поведения](#примеры-ожидаемого-поведения)
- [Известные ограничения](#известные-ограничения)
- [Остановка и перезапуск](#остановка-и-перезапуск)
- [Сервисы вне Docker](#сервисы-вне-docker)
- [Возможности MAX](#возможности-max)
- [Развёртывание](#развёртывание)
- [Разработка](#разработка)
- [Лицензия](#лицензия)

</details>

## Назначение

ППшкин помогает небольшим независимым кафе, кофейням и пекарням Казани продавать остатки дня и находить гостей рядом, а гостям питаться в рамках своего ориентира калорий вне дома.

| `ГОСТЮ` | `ЗАВЕДЕНИЮ` |
|---|---|
| Дневник питания по фото прямо в чате MAX: блюдо, диапазон калорий и БЖУ, остаток до ориентира на сегодня | Горящие позиции со скидкой: гости рядом видят их в подборе, остатки дня продаются вместо списания |
| Подбор конкретного блюда в открытом заведении рядом под остаток калорий, слот приёма пищи и вкусы, с объяснением выбора: факты, расчёты, допущения | Меню вручную или импортом по фото и тексту |
| Горящие позиции со скидкой и бронь по коду из 6 символов и QR | Брони гостей с уведомлением «Новая бронь» и погашение по коду или сканером QR |
| Погашенное блюдо само записывается в дневник | Аналитика: сколько предложений показано, принято и погашено |

## Основной сценарий

Гость и заведение проходят весь путь в MAX, заведение может быть и на том же аккаунте (демо-заведение):

1. Гость открывает бота и отправляет `/start`. Бот здоровается и просит согласие на обработку данных, затем отдельно и необязательно спрашивает согласие на персональные предложения.
2. Гость выбирает цель и ориентир калорий, делится местоположением (хранится с точностью около 1 км) или нажимает «Пропустить».
3. Гость присылает фото еды. Бот распознаёт блюдо, записывает его в дневник с диапазоном калорий и БЖУ и отвечает, сколько осталось до ориентира на сегодня.
4. Гость нажимает «Что поесть?» (`/eat`). Бот подбирает блюдо в открытом заведении рядом под остаток калорий, слот приёма пищи и вкусы и объясняет выбор: факты, расчёты, допущения.
5. Заведение (`/venue`) выставляет горящую позицию со скидкой через мастер «Горящее», гости рядом видят её в подборе.
6. Гость нажимает «Забронировать» и получает код из 6 символов и QR. Заведению приходит сообщение «Новая бронь».
7. У кассы сотрудник гасит бронь: «Погасить код» в боте, ввод кода или сканирование QR в мини-приложении.
8. Блюдо автоматически записывается в дневник гостя, бот присылает гостю «Приятного аппетита!» с остатком на день, заведение видит погашение в статистике.

Подробные шаги с ожидаемым результатом каждого: [docs/scenario.md](docs/scenario.md).

Команды бота (`backend/src/bot/commands.ts`):

| Команда | Что делает | Команда | Что делает |
|---|---|---|---|
| `/start` | начать и настроить | `/profile` | профиль и настройки |
| `/eat` | что поесть рядом | `/venue` | кабинет заведения |
| `/today` | дневник за сегодня | `/help` | помощь |
| `/bookings` | мои брони | `/delete` | удалить аккаунт и данные |

## Состав и архитектура

| Компонент | Код | Что делает |
|---|---|---|
| Бот MAX | `backend/src/bot/` | диалоги гостя и заведения: онбординг и согласия, дневник по фото и тексту, подбор, брони, кабинет заведения, погашение |
| Мини-приложение | `frontend/` | React и MAX UI: дневник, подбор, карточки заведений, брони с QR на весь экран, кабинет заведения, импорт меню, статистика; раздаётся nginx |
| HTTP API | `backend/src/http/` | REST `/api/v1` на Fastify 5, контракт [openapi.yaml](openapi.yaml), Swagger UI `/docs`, проверки `/health` и `/ready`, webhook MAX `/max/webhook`, метрики Prometheus `/metrics` (в продакшене Caddy его не маршрутизирует, снаружи недоступен) |
| Фоновые задачи | `backend/src/jobs/` | истечение броней, обработка зависших импортов меню, очистка ключей обновлений MAX, проверка подписки webhook, ежедневное обновление демо-данных; каждая задача под advisory lock PostgreSQL |
| PostgreSQL 18.6 | `backend/migrations/` | пользователи, согласия, дневник, заведения, меню, акции, показанные предложения, брони, состояние диалогов |
| Caddy 2.11.4 | `deploy/Caddyfile` | только в продакшене: HTTPS на 443, сертификат Let's Encrypt, маршрутизация на backend, frontend и Grafana |
| Мониторинг | `deploy/monitoring/` | только в продакшене: Prometheus, Alertmanager с алертами в Telegram, Grafana с публичным дашбордом, node-exporter и blackbox-exporter |
| Внешние сервисы | `backend/src/integrations/` | MAX Bot API и MAX Bridge, ChadGPT для распознавания фото и меню (раздел «Внешние сервисы и интеграции») |

```mermaid
flowchart LR
  subgraph maxClients["Клиенты MAX"]
    mobile["Мобильное приложение"]
    webClient["Веб-версия web.max.ru"]
  end
  platform["Платформа MAX: Bot API"]
  subgraph server["Сервер"]
    caddy["Caddy: HTTPS 443"]
    frontend["frontend: nginx, мини-приложение"]
    backend["backend: Node 24, Fastify 5, бот, API, фоновые задачи"]
    db[("PostgreSQL 18.6")]
    monitoring["Prometheus, Alertmanager, Grafana"]
  end
  chadgpt["ChadGPT API"]
  telegram["Telegram: чат команды"]
  mobile --> platform
  webClient --> platform
  platform -- "webhook /max/webhook" --> caddy
  mobile -- "мини-приложение" --> caddy
  webClient -- "мини-приложение" --> caddy
  caddy -- "статические файлы" --> frontend
  caddy -- "/api/v1 с Bearer-токеном" --> backend
  backend -- "сообщения, кнопки, QR" --> platform
  backend --> db
  backend -- "фото и текст блюда, меню" --> chadgpt
  caddy -- "/grafana/" --> monitoring
  monitoring -- "/metrics" --> backend
  monitoring -- "алерты" --> telegram
```

Слои backend, последовательности запросов, конвейер рекомендаций и схема базы данных: [docs/architecture.md](docs/architecture.md). Мониторинг и алерты: [docs/deploy.md](docs/deploy.md#11-мониторинг-и-алерты), раздел 11.

## Быстрый запуск

Нужны Docker Engine и Docker Compose 2.24 или новее, подробнее в разделе [Требования к окружению](#требования-к-окружению). Из корня чистого клона, без файла `.env`:

```bash
git clone https://github.com/blsssss/PPshkin.git
cd PPshkin
docker compose up -d --build --wait
```

Команда собирает образы и ждёт, пока все сервисы станут здоровыми:

| Сервис | Адрес | Что проверить |
|---|---|---|
| `db` | `127.0.0.1:55432` | PostgreSQL 18.6, пользователь, пароль и база `ppshkin` |
| `backend` | `http://localhost:3000` | Swagger UI `http://localhost:3000/docs`, `http://localhost:3000/health` отвечает `{"status":"ok"}`, `http://localhost:3000/ready` отвечает `{"status":"ready"}` |
| `frontend` | `http://localhost:8080` | мини-приложение; nginx проксирует `/api/` на backend |

По умолчанию локальный стенд работает в демо-режиме: `DEMO_MODE=true`, демо-токены `local-demo-guest-token-not-secret` (гость) и `local-demo-venue-token-not-secret` (заведение), `BOT_MODE=off`. При старте backend применяет миграции и создаёт тестовые заведения Казани. Проверка, что демо-данные на месте:

```bash
curl -s -H "Authorization: Bearer local-demo-guest-token-not-secret" \
  "http://localhost:3000/api/v1/recommendations?lat=55.7887&lon=49.1221"
```

Мини-приложение входит только по подписанным данным запуска MAX (`initData`), поэтому `http://localhost:8080` в обычном браузере показывает экран «Откройте ППшкин в MAX». Чтобы посмотреть интерфейс вне MAX, запустите dev-сервер Vite с демо-токеном, он проксирует `/api` на `http://127.0.0.1:3000`:

```bash
cd frontend
npm ci
VITE_DEV_TOKEN=local-demo-guest-token-not-secret VITE_DEMO_MODE=true npm run dev
```

и откройте `http://localhost:5173`. `VITE_DEV_TOKEN` действует только в dev-сервере и в сборку не попадает.

> [!NOTE]
> Время сборки: `docker compose build --no-cache` без загрузки базовых образов занял 9 секунд (замер 27.09.2026 на чистой копии, Apple M4 Pro, 14 ядер, arm64, npm-пакеты устанавливались из сети, базовые образы `node`, `nginx-unprivileged` и `postgres` скачаны заранее). Требование брифа: не больше 5 минут. Первый запуск дополнительно скачивает базовые образы, это время зависит от канала.

> [!WARNING]
> Не запускайте локально `BOT_MODE=polling` с токеном рабочего бота. Long polling удаляет подписки webhook, и рабочий бот перестаёт получать сообщения, пока подписку не восстановит задача `max_webhook_guard` на сервере (раз в 10 минут). Для разработки бота нужен отдельный бот со своим токеном.

## Требования к окружению

- Docker Engine и Docker Compose не ниже 2.24: `compose.yaml` использует атрибут `required` у `env_file`. Проверка: `docker compose version`.
- 2 ГБ свободной оперативной памяти.
- Свободные порты 3000, 8080 и 55432 на машине (их можно переназначить через `BACKEND_PORT`, `FRONTEND_PORT` и `DB_PORT`).
- Доступ в интернет для загрузки базовых образов и npm-пакетов при сборке.
- MAX и ChadGPT локально необязательны: без них работают API с демо-токенами, текстовое распознавание по локальному справочнику и ручной ввод (раздел «Сервисы вне Docker»).
- Для разработки без Docker: Node 24.21.0 (`engines` требует не ниже 24.11) и npm из комплекта Node, подробности в [CONTRIBUTING.md](CONTRIBUTING.md).

## Переменные окружения

Переменные backend, compose и сборки мини-приложения перечислены в [.env.example](.env.example) с безопасными локальными значениями, кроме трёх: `NODE_ENV` (объяснение в таблице backend), `PGPASSWORD` (его задаёт compose из `POSTGRES_PASSWORD`) и `NODE_EXTRA_CA_CERTS` (задан в образе backend). Для локального запуска файл `.env` не нужен: значения по умолчанию заданы в `compose.yaml`. Если `.env` есть, `compose.yaml` читает его (`env_file` с `required: false`), а `compose.prod.yaml` требует его обязательно. Схема и проверка переменных backend: `backend/src/config.ts`, при ошибке сервис не стартует и пишет в лог имя переменной.

> [!IMPORTANT]
> **Секреты** отмечены в таблицах жирным. Они хранятся только в секретах GitHub Actions и на сервере (в `.env`, а `ALERT_*` в конфигурации Alertmanager), не коммитятся и не пишутся в логи.

Как получить или сгенерировать секреты:

| Секрет | Как получить |
|---|---|
| **`MAX_BOT_TOKEN`** | токен бота выдают организаторы хакатона (платформа MAX для партнёров) |
| **`CHADGPT_API_KEY`** | ключ API аккаунта ChadGPT с положительным балансом; по возможности отдельный ключ с небольшим балансом |
| **`SESSION_SECRET`** | `openssl rand -hex 32` |
| **`MAX_WEBHOOK_SECRET`** | `openssl rand -hex 32` (подходит под `^[A-Za-z0-9_-]{5,256}$`) |
| **`DEMO_GUEST_TOKEN`**, **`DEMO_VENUE_TOKEN`** | `openssl rand -hex 24` для сервера; локальные значения `local-demo-...` действуют только на локальном стенде и отклоняются при `BOT_MODE=webhook` |
| **`POSTGRES_PASSWORD`** | `openssl rand -hex 24`, как в [docs/deploy.md](docs/deploy.md); локально `ppshkin` |
| **`GRAFANA_ADMIN_PASSWORD`** | `openssl rand -hex 16`, как в [docs/deploy.md](docs/deploy.md); нужен только `compose.prod.yaml` |
| **`ALERT_BOT_TOKEN`**, **`ALERT_CHAT_ID`** | токен Telegram-бота для алертов от @BotFather и id чата команды; секреты репозитория GitHub, их читают `uptime.yml` и выкат, Ansible подставляет их в конфигурацию Alertmanager на сервере; в `.env` и `.env.example` их нет ([docs/deploy.md](docs/deploy.md#11-мониторинг-и-алерты)) |

<details>
<summary><b>Переменные backend</b>: все 30 ключей <code>backend/src/config.ts</code>, обязательность, значение по умолчанию и назначение</summary>

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `NODE_ENV` | нет | `development`; в `compose.yaml` и `compose.prod.yaml` `production` | режим Node: `development`, `production` или `test`. Единственная переменная backend, которой нет в `.env.example`: сборка мини-приложения тоже читает корневой `.env`, и `NODE_ENV=development` там переключил бы `npm run build` в `frontend/` в режим разработки |
| `HOST` | нет | `0.0.0.0` | адрес, на котором слушает HTTP-сервер |
| `PORT` | нет | `3000` | порт HTTP-сервера; в контейнере всегда `3000` |
| `LOG_LEVEL` | нет | `info` | уровень журнала: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |
| `LOG_PRETTY` | нет | `false` | читаемый однострочный журнал через `pino-pretty`; только при запуске из исходников, в Docker-образе этого пакета нет |
| `CORS_ORIGINS` | нет | пусто, CORS выключен | разрешённые origin через запятую; мини-приложение и API работают на одном домене, поэтому обычно не нужно |
| `RATE_LIMIT_PER_MINUTE` | нет | `300` | общий лимит запросов к API в минуту на пользователя (без входа на IP) |
| `TRUST_PROXY` | нет | `false`; в `compose.prod.yaml` `1` | доверие `X-Forwarded-For`: `true`, `false`, число прокси или список IP и CIDR |
| `DATABASE_URL` | да | задаёт `compose.yaml`: `postgres://ppshkin@db:5432/ppshkin` | строка подключения к PostgreSQL |
| `DATABASE_POOL_SIZE` | нет | `10` | размер пула соединений, от 1 до 100 |
| `MIGRATE_ON_START` | нет | `true` | применять миграции из `backend/migrations/` при старте |
| `PUBLIC_BASE_URL` | при `BOT_MODE=webhook` | пусто; в `compose.prod.yaml` `https://${DOMAIN}` | публичный HTTPS-адрес без порта, из него строится адрес webhook `/max/webhook` |
| **`MAX_BOT_TOKEN`** | при `BOT_MODE=webhook`; без него бот и вход в мини-приложение выключены | пусто | токен бота MAX, передаётся в заголовке `Authorization` запросов к MAX Bot API и служит ключом проверки `initData` |
| `BOT_MODE` | нет | `polling` в коде; `off` в `compose.yaml`; `webhook` в `compose.prod.yaml` | режим бота: `polling` для разработки с отдельным ботом, `webhook` в продакшене, `off` без бота |
| `MAX_API_BASE_URL` | нет | `https://platform-api2.max.ru` | адрес MAX Bot API |
| **`MAX_WEBHOOK_SECRET`** | при `BOT_MODE=webhook` | пусто | секрет заголовка `X-Max-Bot-Api-Secret`, который MAX присылает с каждым обновлением на webhook |
| `MINI_APP_ENABLED` | нет | `false` | кнопки открытия мини-приложения в сообщениях бота; включается после регистрации адреса мини-приложения в MAX |
| `PROACTIVE_OFFERS` | нет | `false` | проактивные подсказки тем, кто дал согласие на персональные предложения (задача `proactive_offers` раз в 15 минут); в MVP выключены |
| **`SESSION_SECRET`** | при `BOT_MODE=webhook` | пусто: ключ выводится из `MAX_BOT_TOKEN` | ключ HMAC сессионных токенов мини-приложения, не короче 32 символов |
| `SESSION_TTL_HOURS` | нет | `12` | срок жизни сессии мини-приложения, от 1 до 720 часов |
| `INIT_DATA_MAX_AGE_SECONDS` | нет | `3600` | допустимый возраст `initData`, от 60 до 86400 секунд |
| `DEMO_MODE` | нет | `false` в коде; `true` в `compose.yaml`, если в `.env` нет другого значения | демо-режим: тестовые заведения, демо-учётки, кнопки «Взять демо-заведение» и «Заполнить дневник примером» |
| **`DEMO_GUEST_TOKEN`** | при `DEMO_MODE=true` нужен хотя бы один из двух демо-токенов; без демо-режима токенов быть не должно | пусто; в `compose.yaml` `local-demo-guest-token-not-secret`, если переменной нет в `.env` | Bearer-токен демо-гостя (`userId -1001`), не короче 24 символов. Чтобы выключить демо-режим на локальном стенде, задайте в `.env` `DEMO_MODE=false` и оба токена пустыми |
| **`DEMO_VENUE_TOKEN`** | см. выше | пусто; в `compose.yaml` `local-demo-venue-token-not-secret`, если переменной нет в `.env` | Bearer-токен демо-заведения (`userId -1002`), не короче 24 символов |
| **`CHADGPT_API_KEY`** | нет | пусто | ключ ChadGPT; без него фото не распознаются, текст оценивается по локальному справочнику |
| `CHADGPT_BASE_URL` | нет | `https://ask.chadgpt.ru/api/v1` | адрес OpenAI-совместимого API ChadGPT, только HTTPS |
| `CHADGPT_MODEL` | нет | `gpt-6-luna` | основная модель: `gpt-6-luna`, `gpt-5.6-luna` или `gemini-3-flash-preview` |
| `CHADGPT_FALLBACK_MODEL` | нет | `gemini-3-flash-preview` | запасная модель из того же списка |
| `CHADGPT_TIMEOUT_MS` | нет | `45000` | тайм-аут распознавания блюда, от 1000 до 300000 мс |
| `CHADGPT_MENU_TIMEOUT_MS` | нет | `120000` | тайм-аут разбора меню, от 1000 до 600000 мс |

</details>

<details>
<summary><b>Переменные <code>compose.yaml</code>, <code>compose.prod.yaml</code> и образа backend</b></summary>

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `POSTGRES_USER` | нет | `ppshkin` | пользователь PostgreSQL |
| **`POSTGRES_PASSWORD`** | в `compose.prod.yaml` да | `ppshkin` в `compose.yaml` | пароль PostgreSQL; backend получает его как `PGPASSWORD` |
| `POSTGRES_DB` | нет | `ppshkin` | имя базы |
| `PGPASSWORD` | задаёт compose | значение `POSTGRES_PASSWORD` | пароль для драйвера `pg`, в `DATABASE_URL` пароля нет |
| `DB_PORT` | нет | `55432` | порт PostgreSQL на `127.0.0.1` (только `compose.yaml`) |
| `BACKEND_PORT` | нет | `3000` | порт backend на машине (только `compose.yaml`) |
| `FRONTEND_PORT` | нет | `8080` | порт мини-приложения на машине (только `compose.yaml`) |
| `DOMAIN` | в `compose.prod.yaml` да | нет | домен сервиса для Caddy и `PUBLIC_BASE_URL` |
| `ACME_EMAIL` | в `compose.prod.yaml` да | нет | почта для уведомлений Let's Encrypt |
| **`GRAFANA_ADMIN_PASSWORD`** | в `compose.prod.yaml` да | нет | пароль пользователя `admin` в Grafana мониторинга продакшена |
| `IMAGE_TAG` | нет | `latest` | тег образов `ghcr.io/blsssss/ppshkin-backend` и `ghcr.io/blsssss/ppshkin-frontend`, например `sha-<7 символов коммита>` |
| `NODE_EXTRA_CA_CERTS` | задан в `backend/Dockerfile` | `/app/certs/russian_trusted_root_ca.pem` | корневой сертификат Минцифры для `platform-api2.max.ru`; при запуске бота из исходников задайте `NODE_EXTRA_CA_CERTS=certs/russian_trusted_root_ca.pem` из каталога `backend` |

</details>

<details>
<summary><b>Переменные сборки мини-приложения</b>: аргументы сборки <code>frontend/Dockerfile</code>, попадают в статические файлы</summary>

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `VITE_MAX_BOT_NAME` | для ссылок на бота | пусто | ник бота для ссылок `https://max.ru/<ник>?startapp=...` и кнопки «Открыть бота в MAX»; для рабочего бота `t516_hakaton_max_bot` |
| `VITE_API_BASE_URL` | нет | пусто, API на том же домене | базовый адрес API, если API вынесен на другой домен |
| `VITE_DEMO_MODE` | нет | `false` в `frontend/Dockerfile`; `true` в `compose.yaml` | показывать демо-кнопки в кабинете заведения |
| `VITE_DEV_TOKEN` | нет | пусто | Bearer-токен для dev-сервера Vite вне MAX, например локальный демо-токен; в production-сборке не используется |

</details>

<details>
<summary><b>Переменная живых проверок</b> <code>npm run smoke</code></summary>

Живые проверки ([docs/smoke.md](docs/smoke.md)) читают переменные backend из таблицы выше и ещё одну свою:

| Переменная | Обязательна | По умолчанию | Назначение |
|---|---|---|---|
| `MAX_BOT_USERNAME` | для проверки `max.me` | пусто | ник бота без `@`, с которым сверяется ответ MAX на `getMe`; для рабочего бота `t516_hakaton_max_bot`. Используется только живыми проверками, backend её не читает |

</details>

Секреты и переменные GitHub для публикации образов, выката и мониторинга (`MAX_BOT_USERNAME`, `ALERT_BOT_TOKEN`, `ALERT_CHAT_ID` и другие) описаны в [docs/deploy.md](docs/deploy.md), секреты и переменные живых проверок в [docs/smoke.md](docs/smoke.md).

## Порты

| Порт | Переменная | Что | Где |
|---|---|---|---|
| 3000 | `BACKEND_PORT` | HTTP API `/api/v1`, Swagger UI `/docs`, `/health`, `/ready` | локально; в контейнере 3000 |
| 8080 | `FRONTEND_PORT` | мини-приложение (nginx) | локально; в контейнере 8080 |
| 55432 | `DB_PORT` | PostgreSQL, только `127.0.0.1` | локально; в контейнере 5432 |
| 80, 443 TCP, 443 UDP | нет | Caddy в продакшене (`compose.prod.yaml`), Grafana по пути `/grafana/` | только продакшен; backend, база, Prometheus, Alertmanager и экспортеры наружу не публикуются |
| 5173 | нет | dev-сервер Vite (`npm run dev` в `frontend/`) | только разработка |

## Зависимости

| Что | Версия | Где зафиксирована |
|---|---|---|
| Node.js | 24.21.0 | образ `node:24.21.0-alpine3.24`, CI, `engines` в `package.json` (не ниже 24.11) |
| PostgreSQL | 18.6 | образ `postgres:18.6-alpine3.24` |
| Caddy | 2.11.4 | образ `caddy:2.11.4-alpine` (только продакшен) |
| nginx | 1.31.6 | образ `nginxinc/nginx-unprivileged:1.31.6-alpine3.24` |
| Prometheus, Alertmanager, Grafana | 3.15.0, 0.34.1, 13.2.2 | образы мониторинга в `compose.prod.yaml` (только продакшен) |

<details>
<summary><b>Образы Docker</b></summary>

| Образ | Где используется |
|---|---|
| `node:24.21.0-alpine3.24` | сборка и запуск backend (`backend/Dockerfile`), сборка мини-приложения (`frontend/Dockerfile`) |
| `nginxinc/nginx-unprivileged:1.31.6-alpine3.24` | раздача мини-приложения (`frontend/Dockerfile`) |
| `postgres:18.6-alpine3.24` | `db` в `compose.yaml` и `compose.prod.yaml`, CI |
| `caddy:2.11.4-alpine` | `caddy` в `compose.prod.yaml` |
| `ghcr.io/blsssss/ppshkin-backend:${IMAGE_TAG:-latest}` | `backend` в `compose.prod.yaml` |
| `ghcr.io/blsssss/ppshkin-frontend:${IMAGE_TAG:-latest}` | `frontend` в `compose.prod.yaml` |
| `prom/prometheus:v3.15.0` | `prometheus` в `compose.prod.yaml`, `promtool test rules` в CI |
| `prom/alertmanager:v0.34.1` | `alertmanager` в `compose.prod.yaml` |
| `prom/blackbox-exporter:v0.28.0` | `blackbox` в `compose.prod.yaml` |
| `prom/node-exporter:v1.12.1` | `node-exporter` в `compose.prod.yaml` |
| `grafana/grafana:13.2.2` | `grafana` в `compose.prod.yaml` |

</details>

<details>
<summary><b>npm-пакеты backend</b>: <code>backend/package.json</code>, точные версии в <code>backend/package-lock.json</code></summary>

| Пакет | Версия | Назначение |
|---|---|---|
| `fastify` | 5.12.5 | HTTP-сервер |
| `fastify-type-provider-zod` | 7.0.0 | валидация и сериализация через zod, генерация OpenAPI |
| `zod` | 4.6.5 | схемы конфигурации, запросов и ответов |
| `@fastify/swagger` | 9.9.0 | документ OpenAPI 3.1 |
| `@fastify/swagger-ui` | 6.1.1 | Swagger UI на `/docs` |
| `@fastify/rate-limit` | 11.2.0 | ограничение частоты запросов |
| `@fastify/helmet` | 13.1.1 | заголовки безопасности |
| `@fastify/cors` | 11.3.0 | CORS |
| `@fastify/multipart` | 10.1.2 | загрузка фото еды и меню |
| `pg` | 8.23.0 | драйвер PostgreSQL |
| `prom-client` | 15.1.3 | метрики Prometheus на `/metrics` |
| `sharp` | 0.35.4 | перекодирование фото в JPEG до 1024 px без метаданных |
| `qrcode` | 1.5.4 | PNG с QR-кодом брони |

Точные версии всех зависимостей: [backend/package-lock.json](backend/package-lock.json). Инструменты разработки backend: `typescript` 6.0.3, `vitest` 4.1.11, `@vitest/coverage-v8` 4.1.11, `eslint` 10.11.0, `typescript-eslint` 8.70.1, `@eslint/js` 10.0.1, `prettier` 3.9.9, `ajv` 8.20.0 и `ajv-formats` 3.0.1 (проверка ответов по контракту), `@apidevtools/swagger-parser` 13.1.0, `openapi-types` 12.1.3, `yaml` 2.9.1, `pino-pretty` 13.1.3, `@types/node` 24.13.6, `@types/pg` 8.23.1, `@types/qrcode` 1.5.6.

</details>

<details>
<summary><b>npm-пакеты мини-приложения</b>: <code>frontend/package.json</code>, точные версии в <code>frontend/package-lock.json</code></summary>

| Пакет | Версия | Назначение |
|---|---|---|
| `react`, `react-dom` | 19.2.8 | интерфейс |
| `react-router` | 8.4.0 | маршруты экранов и переходы по `startapp` |
| `@maxhub/max-ui` | 0.5.0 | компоненты интерфейса MAX (MIT) |
| `@tanstack/react-query` | 5.104.0 | запросы к API и кэш |
| `openapi-fetch` | 0.17.0 | типизированный клиент API по `openapi.yaml` |
| `qrcode` | 1.5.4 | QR ссылки для гостей в кабинете заведения (QR брони приходит PNG из `GET /api/v1/bookings/{id}/qr`) |
| `@fontsource/jetbrains-mono` | 5.3.0 | моноширинный шрифт интерфейса |

Точные версии всех зависимостей: [frontend/package-lock.json](frontend/package-lock.json). Инструменты разработки мини-приложения: `vite` 8.3.1, `@vitejs/plugin-react` 6.1.1, `typescript` 6.0.3, `vitest` 5.0.2, `jsdom` 30.1.1, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `eslint` 10.11.0, `eslint-plugin-react-hooks` 7.1.1, `typescript-eslint` 8.70.1, `@eslint/js` 10.0.1, `prettier` 3.9.9, `@types/react` 19.2.18, `@types/react-dom` 19.2.7, `@types/node` 24.13.6, `@types/qrcode` 1.5.6. Типы клиента API генерирует `openapi-typescript` 7.13.0 (скрипт `api:generate`).

</details>

## Внешние сервисы и интеграции

| Сервис | Назначение | Адрес и условия | Что передаётся |
|---|---|---|---|
| MAX Bot API | сообщения бота, кнопки, загрузка изображений, webhook | `https://platform-api2.max.ru` (обязателен с 19.07.2026), сертификат цепочки Минцифры (`backend/certs/russian_trusted_root_ca.pem`, `NODE_EXTRA_CA_CERTS`), токен в заголовке `Authorization`; лимиты 30 запросов в секунду и 2 сообщения в секунду на чат; webhook только HTTPS на порт 443 с доверенным сертификатом, ответ 200 за 30 секунд | тексты ответов бота, клавиатуры, QR-код брони; от MAX приходят сообщения, фото и геопозиция пользователя |
| MAX Bridge | данные запуска мини-приложения и функции устройства | скрипт `https://st.max.ru/js/max-web-app.js`; подпись `initData` проверяется на бэкенде (HMAC-SHA256 с ключом `WebAppData` и токеном бота) | ничего не отправляется во внешние сервисы, кроме вызовов функций клиента MAX |
| MAX UI | компоненты интерфейса мини-приложения | `@maxhub/max-ui` 0.5.0, лицензия MIT | нет |
| ChadGPT | распознавание блюд по фото и тексту, разбор меню | `https://ask.chadgpt.ru/api/v1`, OpenAI-совместимый API, ключ `CHADGPT_API_KEY`, модели `gpt-6-luna` и запасная `gemini-3-flash-preview`; фото блюда 4-10 с, меню 11-23 с | фото после перекодирования в JPEG не больше 1024 px по длинной стороне без метаданных (EXIF, GPS), текст описания блюда или меню, системная инструкция. Не передаются идентификаторы MAX, имя, телефон, местоположение. Место обработки данных провайдером не подтверждено, поэтому сервис считается возможно трансграничным |
| Let's Encrypt | сертификат HTTPS в продакшене | через Caddy (#19) | доменное имя |
| GitHub Container Registry | образы backend и frontend | `ghcr.io/blsssss/ppshkin-backend`, `ghcr.io/blsssss/ppshkin-frontend` (#19) | нет |
| Telegram Bot API | алерты мониторинга в чат команды | Alertmanager в продакшене и workflow `uptime.yml` в GitHub Actions, секреты `ALERT_BOT_TOKEN` и `ALERT_CHAT_ID` ([docs/deploy.md](docs/deploy.md#11-мониторинг-и-алерты), раздел 11) | название и описание алерта, состояние сервиса; данных пользователей нет |

Клиент MAX Bot API в backend сам держит запас по лимитам: не больше 25 запросов в секунду всего и 2 в секунду на чат, повторяет запрос при временных ошибках.

## Работа с данными

| Данные | Где хранятся | Срок | Кому видны |
|---|---|---|---|
| id и имя в MAX | `users` | до удаления аккаунта | никому |
| приёмы пищи: название, диапазон ккал, БЖУ, теги, время | `meals` | до удаления записи или аккаунта | никому |
| фото еды | не хранится | не хранится | перекодированная копия без метаданных уходит в ChadGPT |
| приблизительное местоположение, координаты округлены до сотых градуса (около 1 км) | `users` | до удаления аккаунта или очистки | никому |
| согласия: вид, версия, канал, время выдачи и отзыва | `consents` | до удаления аккаунта | никому |
| показанные предложения и объяснения | `offers` | при удалении аккаунта объяснения очищаются, строки обезличиваются | заведение видит только агрегаты |
| брони | `bookings` | при удалении аккаунта обезличиваются | заведение видит код, блюдо, время и статус |
| состояние диалога с ботом | `chat_states` | до удаления аккаунта | никому |
| ключи обработанных обновлений MAX | `processed_updates` | 2 дня | никому |

- Не собираются диагнозы, медицинские диеты и аллергии, телефон, точная геопозиция.
- Согласия: обязательное `personal_data` перед любой работой с дневником и отдельное необязательное `personalized_offers` для персональных предложений; версии и тексты в `backend/src/domain/consents.ts`. Персональные предложения отключаются одной кнопкой «Не присылать подсказки» или в `/profile`.
- Удаление: `/delete` в боте или удаление аккаунта в мини-приложении (`DELETE /api/v1/me`), сразу и бесплатно. Активные брони отменяются, объяснения предложений очищаются, брони и показы обезличиваются, остальные записи удаляются каскадно.
- В ChadGPT уходят только фото, перекодированное в JPEG не больше 1024 px без EXIF и GPS, или текст описания блюда и меню. Идентификаторы MAX, имя и местоположение не передаются.
- В продакшене база данных размещается на сервере в России (152-ФЗ, ст. 18, ч. 5), требования к серверу в [docs/deploy.md](docs/deploy.md).
- Журнал запросов Caddy выключен, в логах backend маскируются заголовки `Authorization` и `X-Max-Bot-Api-Secret`. Журнал backend записывает о запросе только метод и путь, без параметров (в подборе и каталоге это координаты) и без IP-адреса клиента; журналы контейнеров в продакшене ротируются, не больше пяти файлов по 10 МБ на сервис.
- Метрики Prometheus агрегированы: время ответа по шаблону маршрута, счётчики пользователей, записей дневника, броней и предложений без идентификаторов и координат; сырые пути в метки не попадают.

Полная политика обработки данных, тексты согласий и правовые основания: [docs/privacy.md](docs/privacy.md), пользовательское соглашение: [docs/terms.md](docs/terms.md).

## Тестовые данные

Все заведения, меню, акции и история аналитики в демо-режиме смоделированы и не относятся к реальным заведениям. В боте и мини-приложении у них есть пометка «Заведение и меню тестовые».

Демо-режим включается `DEMO_MODE=true` (локально по умолчанию). При каждом старте backend идемпотентно создаёт или обновляет демо-учётки, заведения и меню, а затем обновляет горящие позиции на сегодня, дневник демо-гостя и историю аналитики. То же обновление выполняет задача `refresh_demo_data` ежедневно в 06:00 по Москве. На локальном запуске в журнале backend видно `demo data seeded` с `"venues":6` и `"menuItems":64`.

Учётки для API (заголовок `Authorization: Bearer <токен>`):

| Роль | `userId` | Токен локально | Токен на сервере | Что есть |
|---|---|---|---|---|
| демо-гость | `-1001` | `local-demo-guest-token-not-secret` | значение `DEMO_GUEST_TOKEN`, передаётся жюри вне репозитория | ориентир 1800 ккал, цель поддерживать вес, не любит рыбу, местоположение у площади Тукая, дневник за 5 прошлых дней с привычкой сладкого около 16:00, согласие на обработку данных уже дано |
| демо-заведение | `-1002` | `local-demo-venue-token-not-secret` | значение `DEMO_VENUE_TOKEN` | владелец тестовой кофейни «Зерно» (`id 900001`) с меню, горящими позициями на сегодня и историей показов и броней за 7 прошлых дней |

Файлы:

- [backend/testdata/venues.json](backend/testdata/venues.json): 6 заведений Казани с меню и шаблонами горящих позиций;
- [backend/testdata/demo-guest.json](backend/testdata/demo-guest.json): профиль и шаблон дневника демо-гостя;
- [backend/testdata/accounts.json](backend/testdata/accounts.json): тестовые учётки и роли;
- [backend/testdata/samples/dish.jpg](backend/testdata/samples/dish.jpg) и [backend/testdata/samples/menu.txt](backend/testdata/samples/menu.txt): образцы для живых проверок распознавания ([docs/smoke.md](docs/smoke.md)); фото блюда снято участником команды (собственное фото, метаданные EXIF и GPS удалены), в Docker-образ образцы не попадают.

Фиксированные id:

| id | Заведение | Позиции меню |
|---|---|---|
| 900001 | Кофейня «Зерно», ул. Баумана, 36, 08:00-22:00, владелец демо-заведение | 9101xx, например 910101 Капучино |
| 900002 | Кофейня «Пенка», без владельца, круглосуточно | 9102xx, например 910201 Капучино |
| 900003 | Пекарня «Утренний хлеб» | 9103xx |
| 900004 | Столовая «Обед на Кремлёвской» | 9104xx |
| 900005 | Кафе «Зелёная тарелка» | 9105xx |
| 900006 | Кафе «Чайхана у Булака» | 9106xx |

Координаты для примеров: `lat=55.7887`, `lon=49.1221`. Бронь в «Пенке» (`menuItemId` 910201) можно создавать в любое время суток: её никто не погасит, через 60 минут она истекает.

В MAX подходит любой аккаунт:

- роль заведения: `/venue`, затем «Взять демо-заведение». Создаётся личная копия кофейни «Зерно» с меню и горящими позициями на остаток дня; копию видит только владелец, в его подборе она заменяет исходное заведение;
- готовый профиль вкусов: кнопка «Заполнить дневник примером» (после онбординга или в «Что поесть?») добавляет 26 приёмов пищи за 5 прошлых дней с пометкой «(пример)».

Сброс всех данных локального стенда: `docker compose down -v`, затем `docker compose up -d --wait`. Миграции и демо-данные создаются заново.

## Сценарий проверки

Шаги 1-10 проходятся на рабочем боте [https://max.ru/t516_hakaton_max_bot](https://max.ru/t516_hakaton_max_bot) в мобильном приложении или веб-версии MAX с любого аккаунта. Бронь и погашение в кофейне «Зерно» проверяйте с 08:00 до 22:00 по Москве. Шаги 11-12 выполняются на локальном стенде. Полная версия с ветками ошибок: [docs/scenario.md](docs/scenario.md). Перед сдачей и после каждого деплоя основной сценарий проходится по чек-листу в веб-версии MAX, на Android и на iOS, а интеграции проверяются живыми проверками `npm run smoke`: [docs/smoke.md](docs/smoke.md).

| № | Действие | Ожидаемый результат |
|---|---|---|
| 1 | Открыть бота и нажать «Начать» или отправить `/start` | приветствие «Привет! Я ППшкин...» и запрос согласия с кнопками «Согласен» и «Подробнее» |
| 2 | «Согласен» | «Согласие получено, спасибо!» и вопрос о персональных предложениях с кнопками «Да, присылать» и «Нет, спасибо» |
| 3 | Ответить, выбрать цель и ориентир, например 1800 | «Ориентир: 1800 ккал в день.» и просьба о местоположении с кнопками «Отправить местоположение» и «Пропустить» |
| 4 | «Отправить местоположение» или «Пропустить» | «Готово! Пришлите фото блюда или напишите, что съели...» и кнопка «Заполнить дневник примером» |
| 5 | Отправить фото еды | «Смотрю на фото, это до 15 секунд...», затем «Записал: <блюдо>, <от>-<до> ккал», БЖУ и остаток на день, кнопки «Верно», «Исправить», «Удалить» |
| 6 | «Заполнить дневник примером», затем «Что поесть?» | «Добавили пример дневника за 5 дней...»; без местоположения бот сначала спрашивает «Где вы?» с кнопками «Отправить местоположение» и «Искать по всему городу»; затем карточка блюда в открытом заведении: заголовок, цена, ккал, расстояние, блок «Почему:» с фактами и расчётами, допущения и «Заведение и меню тестовые»; кнопки «Забронировать», «Другое», «Не сегодня», «Не люблю такое», «Маршрут» |
| 7 | `/venue`, затем «Взять демо-заведение» | «Готово, вы управляете копией кофейни «Зерно»...», кабинет с кнопками «Меню», «Горящее», «Брони», «Погасить код», «Статистика» |
| 8 | «Горящее», «Новое горящее предложение»: позиция, количество, скидка, срок, «Опубликовать» | «Опубликовано. Гости рядом увидят предложение в подборе.» и ссылка для гостей `https://max.ru/t516_hakaton_max_bot?start=d_<id>` |
| 9 | Открыть ссылку для гостей из шага 8 и нажать «Забронировать» | карточка горящей позиции с ценой со скидкой и остатком порций; после брони сообщение «Бронь <код>», «Действует до ЧЧ:ММ. Покажите код или QR на кассе.» с изображением QR; в тот же чат приходит «Новая бронь <код>» с кнопками «Погасить» и «Все брони» |
| 10 | «Погасить код» в кабинете и ввести код | «Погашено: <позиция>, <цена> ₽. Блюдо добавлено гостю в дневник.»; следом «Приятного аппетита! В дневник записано: ...» с остатком на день; `/today` показывает блюдо, «Статистика» учитывает погашение |
| 11 | `docker compose up -d --build --wait` из чистого клона | контейнеры `db`, `backend`, `frontend` в состоянии `healthy`, `http://localhost:3000/ready` отвечает `{"status":"ready"}` |
| 12 | запросы из раздела «Примеры ожидаемого поведения» | рекомендация 200 с `status` и `items`, бронь 201 с `code` и `qrPayload`, без токена 401 `application/problem+json`, пустой `title` 400 `validation_failed` |

## Примеры ожидаемого поведения

Ответы получены на локальном стенде с демо-данными 27.09.2026 около 00:50 по Москве, когда из тестовых заведений было открыто только круглосуточное «Пенка». Ответы сокращены: из массивов оставлен один элемент, из вложенных `item` и `venue` основные поля. Значения `offerId`, `id`, `code` и времени на каждом стенде свои.

**Рекомендация для демо-гостя**, ответ `200 OK`:

```bash
curl -s -H "Authorization: Bearer local-demo-guest-token-not-secret" \
  "http://localhost:3000/api/v1/recommendations?lat=55.7887&lon=49.1221&limit=3"
```

<details>
<summary>Ответ</summary>

```json
{
  "status": "ok",
  "slot": "snack",
  "remainingKcal": 1800,
  "slotBudgetKcal": 180,
  "demoCenterUsed": false,
  "items": [
    {
      "offerId": 58,
      "headline": "Можно позволить десерт",
      "facts": [
        "Сегодня в дневнике ещё нет записей",
        "«Макарон» в «Кофейня «Пенка»»: 180 ккал по данным заведения"
      ],
      "calculations": ["До ориентира 1800 ккал остаётся около 1800 ккал", "Идти около 350 м"],
      "assumptions": [
        "Калорийность приблизительная, это не медицинская рекомендация",
        "Заведение и меню тестовые"
      ],
      "score": 0.6595,
      "item": { "id": 910211, "name": "Макарон", "category": "dessert", "priceRub": 190, "kcal": 180 },
      "venue": { "id": 900002, "name": "Кофейня «Пенка»", "address": "Казань, ул. Петербургская, 9", "isDemo": true },
      "deal": null,
      "distanceM": 361,
      "priceRub": 190,
      "kcal": 180
    }
  ]
}
```

</details>

**Создание брони**, ответ `201 Created`:

```bash
curl -s -X POST -H "Authorization: Bearer local-demo-guest-token-not-secret" \
  -H "Content-Type: application/json" -d '{"menuItemId": 910201}' \
  http://localhost:3000/api/v1/bookings
```

<details>
<summary>Ответ</summary>

```json
{
  "id": 22,
  "code": "87NQWT",
  "qrPayload": "ppshkin:booking:87NQWT",
  "status": "active",
  "expiresAt": "2026-09-26T22:49:45.379Z",
  "createdAt": "2026-09-26T21:49:45.379Z",
  "resolvedAt": null,
  "dealId": null,
  "item": { "id": 910201, "name": "Капучино", "priceRub": 210, "kcal": 130 },
  "venue": { "id": 900002, "name": "Кофейня «Пенка»", "isDemo": true },
  "priceRub": 210,
  "kcal": 130
}
```

</details>

**Бронь в закрытом заведении** (кофейня «Зерно» ночью), ответ `409 Conflict`:

```json
{"type":"about:blank","title":"Conflict","status":409,"code":"venue_closed","detail":"The venue is closed now"}
```

**Запрос без токена**, ответ `401 Unauthorized`:

```bash
curl -s -i http://localhost:3000/api/v1/me
```

```http
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer
content-type: application/problem+json; charset=utf-8

{"type":"about:blank","title":"Unauthorized","status":401,"code":"unauthorized","detail":"Authentication required"}
```

С неверным токеном код другой: `{"type":"about:blank","title":"Unauthorized","status":401,"code":"invalid_token","detail":"Token is invalid or expired, sign in again"}`.

**Невалидное тело запроса**, ответ `400 Bad Request`, `content-type: application/problem+json`:

```bash
curl -s -X POST -H "Authorization: Bearer local-demo-guest-token-not-secret" \
  -H "Content-Type: application/json" -d '{"title": ""}' \
  http://localhost:3000/api/v1/diary/meals
```

<details>
<summary>Ответ</summary>

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "code": "validation_failed",
  "detail": "Request validation failed",
  "errors": [
    { "path": "body.title", "message": "Too small: expected string to have >=1 characters" },
    { "path": "body.kcal", "message": "send kcal or the pair kcalMin and kcalMax" }
  ]
}
```

</details>

**Реплики бота** (тексты из `backend/src/bot/texts.ts`, `backend/src/bot/venue/texts.ts` и `backend/src/notifications/texts.ts`, кнопки в квадратных скобках).

Фото еды. Сначала бот отвечает «Смотрю на фото, это до 15 секунд...», затем заменяет это сообщение результатом. Формат одинаков для фото и текста; числа ниже из локального прогона текста «съел борщ и кусок хлеба» по справочнику типичных порций (без ChadGPT справочник узнал только борщ):

```text
Записал: Борщ, 180-280 ккал
Б 8 г, Ж 11 г, У 22 г
Сегодня около 230 из 1800 ккал, осталось около 1570 ккал
[Верно] [Исправить] [Удалить]
```

Фото не еды:

```text
Похоже, на фото не еда. Пришлите фото блюда или напишите, что съели, например: Сырники 350
[Ввести вручную]
```

Фото без ключа ChadGPT: «Распознавание фото сейчас выключено. Напишите, что съели, например: Сырники 350». Сбой ChadGPT: «Сервис распознавания не ответил. Попробуйте через минуту или напишите вручную, например: Сырники 350».

Погашение брони. Заведению после ввода кода (позиция 910101 Капучино, 220 ₽, 130 ккал):

```text
Погашено: Капучино, 220 ₽. Блюдо добавлено гостю в дневник.
[Погасить ещё] [Брони]
```

Гостю в тот же момент:

```text
Приятного аппетита! В дневник записано: Капучино, около 130 ккал.
Сегодня около <съедено> из <ориентир> ккал, осталось около <остаток> ккал
[Дневник за сегодня]
```

## Известные ограничения

- Калорийность и БЖУ это оценка по фото или тексту, а не медицинская рекомендация. Роскачество при проверке популярных приложений нашло ошибку около 100 ккал на порцию смешанного блюда; поэтому калорийность всегда показывается диапазоном.
- Заведения, меню, акции и история аналитики тестовые (#17).
- Распознавание зависит от ChadGPT: без ключа или при сбое фото не распознаются, текст оценивается по локальному справочнику типичных порций, ручной ввод доступен всегда.
- Предложения показываются только по запросу пользователя. Проактивные сообщения выключены (`PROACTIVE_OFFERS=false`): п. 1.5 требований MAX к контенту запрещает массовые рекламные рассылки без договора с MAX.
- Нет оплаты, доставки и платного продвижения; маркировки рекламы (erid) нет, потому что ранжирование не платное.
- Одно заведение на владельца; нет интеграции с кассой и учётом остатков.
- Голосовые сообщения и видеокружки бот не обрабатывает: платформа присылает для них пустые обновления.
- Местоположение хранится с точностью около 1 км; в веб-версии MAX геопозиция берётся из браузера или через кнопку бота.
- ChadGPT может обрабатывать данные за пределами России: до промышленного запуска подтвердить место обработки у провайдера или перейти на провайдера с обработкой в России.

## Остановка и перезапуск

| Команды | Что происходит | Данные |
|---|---|---|
| `docker compose stop`, затем `docker compose start` | контейнеры останавливаются без удаления и запускаются снова | сохраняются |
| `docker compose down`, затем `docker compose up -d --wait` | удаляются контейнеры и сеть, затем создаются заново | остаются в томе `pgdata`: дневник, брони и заведения на месте |
| `docker compose down -v`, затем `docker compose up -d --wait` | удаляется и том `pgdata` | удаляются все; схема и демо-данные создаются заново |
| `docker compose up -d --build --wait` | пересборка образов после изменения кода | сохраняются |

Миграции (`backend/migrations/0001_init.sql`, `0002_offer_feedback.sql`, `0003_demo_copies.sql`) и демо-данные применяются идемпотентно при каждом старте: уже применённые миграции сверяются по контрольной сумме и не выполняются повторно.

## Сервисы вне Docker

Контейнеры поднимают backend, мини-приложение и базу, но не заменяют две внешние системы.

| Сервис | Зачем | Условия проверки | Что работает без него |
|---|---|---|---|
| MAX | платформа мессенджера, клиенты (мобильный и веб), бот и мини-приложение | нужен выданный организаторами токен бота (`MAX_BOT_TOKEN`), публичный HTTPS-адрес на порту 443 с доверенным сертификатом для webhook и мини-приложения, регистрация адреса мини-приложения в настройках бота ([docs/deploy.md](docs/deploy.md)) | весь HTTP API с демо-токенами, Swagger UI, демо-данные; мини-приложение в dev-сервере Vite с `VITE_DEV_TOKEN` |
| ChadGPT | распознавание блюд по фото и тексту, разбор меню по фото | ключ `CHADGPT_API_KEY` с положительным балансом, доступ к `https://ask.chadgpt.ru/api/v1` | оценка текста по локальному справочнику типичных порций, разбор текстового меню эвристикой, ручной ввод «Сырники 350»; фото еды и фото меню не распознаются |

Контейнеризация не заменяет работающую версию в MAX. Проверка в MAX идёт на рабочем боте [https://max.ru/t516_hakaton_max_bot](https://max.ru/t516_hakaton_max_bot) («Хакатон МАХ 516»), мини-приложение открывается кнопкой в чате с ботом или по ссылке [https://max.ru/t516_hakaton_max_bot?startapp](https://max.ru/t516_hakaton_max_bot?startapp).

## Возможности MAX

| Возможность | Где в продукте |
|---|---|
| Кнопка `open_app` в сообщениях бота | «Открыть дневник» в `/today`, «Рассчитать» при выборе ориентира, «Открыть кабинет» в `/venue`; включается `MINI_APP_ENABLED=true` |
| Кнопка `request_geo_location` | онбординг, «Что поесть?», «Я в другом месте», `/profile`, «Отправить точку» в мастере создания заведения |
| Диплинки `?start=` | ссылки для гостей из кабинета заведения: `https://max.ru/<бот>?start=v_<id заведения>` и `?start=d_<id горящей позиции>` открывают карточку в чате с ботом |
| Диплинки `?startapp=` | `venue_<id>`, `deal_<id>`, `booking_<id>`, `import_<id>`: мини-приложение сразу открывает нужный экран; ссылки-кнопки бота «Открыть в мини-приложении» и «Меню и все предложения», QR на столе из «Ссылка для гостей» |
| Вход по `initData` | мини-приложение входит без логина и пароля, подпись проверяет backend (`POST /api/v1/auth/max`) |
| QR-сканер `openCodeReader` | кабинет заведения, «Погасить бронь», «Сканировать QR гостя» |
| `requestScreenMaxBrightness` | QR брони на весь экран («Показать сотруднику»), после закрытия яркость возвращается |
| `shareMaxContent` | «Поделиться» карточкой заведения, ссылкой для гостей и горящей позицией |
| `HapticFeedback` | вибрация при успехе, ошибке, выборе вкладок (iOS и Android) |
| `BackButton` | системная кнопка «Назад» на вложенных экранах и в открытых панелях |
| `enableClosingConfirmation` | подтверждение закрытия формы с несохранёнными данными |
| Отправка изображений ботом | QR брони загружается в MAX и приходит в чат картинкой |

Вызовы MAX Bridge собраны в `frontend/src/max/bridge.ts`, кнопки и отправка изображений бота в `backend/src/integrations/max/messenger.ts`. Подробная таблица с заменами для клиентов без поддержки, сценарии и скриншоты: [docs/max-features.md](docs/max-features.md).

## Развёртывание

Продакшен работает на сервере в России из `compose.prod.yaml`: Caddy с Let's Encrypt, образы backend и мини-приложения из GHCR, PostgreSQL на томе Docker, бот в режиме webhook. Каждый push в `main` выкатывается автоматически: GitHub Actions собирает образы с тегом коммита, Ansible из [deploy/ansible](deploy/ansible) собирает `.env` из секретов окружения `production`, делает копию базы, поднимает сервисы и при неудаче возвращает предыдущую версию. Мониторинг: Prometheus, Alertmanager с алертами в чат команды и публичный дашборд Grafana `https://hackathon.easymythic.dev/grafana/` с метриками API, продукта и сервера. Настройка сервера, секреты, webhook, регистрация мини-приложения, заморозка версии, откат, резервные копии и мониторинг: [docs/deploy.md](docs/deploy.md).

## Разработка

Ветки, pull request, соглашения кода, тесты и локальное окружение описаны в [CONTRIBUTING.md](CONTRIBUTING.md). Коротко:

```bash
docker compose up -d --wait db
cd backend
npm ci
npm run lint
npm run typecheck
npm test
```

`openapi.yaml` генерируется из кода командой `npm run openapi` в `backend/`, мини-приложение генерирует из него типы клиента. CI (`.github/workflows/ci.yml`) проверяет backend, frontend, сборку и запуск `compose.yaml`, а также выкат `compose.prod.yaml` с Caddy плейбуком Ansible на раннере CI вместе с автоматическим откатом неисправной версии.

Живые проверки MAX, ChadGPT и рабочего API (`npm run smoke` в `backend/`, workflow `.github/workflows/smoke.yml`) обращаются к настоящим сервисам и запускаются только вручную, в CI их нет: [docs/smoke.md](docs/smoke.md).

Ошибки и вопросы: [Issues](https://github.com/blsssss/PPshkin/issues).

## Лицензия

MIT, см. [LICENSE](LICENSE).
