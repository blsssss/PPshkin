# Развёртывание на сервере

Инструкция поднимает ППшкин на одном сервере: Caddy принимает HTTPS на 443 и сам выпускает сертификат Let's Encrypt, backend и мини-приложение запускаются из готовых образов GHCR, PostgreSQL хранит данные на томе Docker. Всё описано в [compose.prod.yaml](../compose.prod.yaml) и [deploy/Caddyfile](../deploy/Caddyfile), образы публикует [publish.yml](../.github/workflows/publish.yml), та же конфигурация каждый раз проверяется в job `deploy` из [ci.yml](../.github/workflows/ci.yml).

Рабочий домен сервиса `hackathon.easymythic.dev`, ниже `<домен>` означает его. Наружу опубликован только Caddy (порты 80, 443/tcp и 443/udp). Backend и база доступны только внутри сети проекта Docker.

Маршрутизация Caddy:

| Путь | Куда |
|---|---|
| `/api/*`, `/docs`, `/docs/*`, `/health`, `/ready`, `/max/webhook` | `backend:3000` |
| всё остальное | `frontend:8080` (статические файлы мини-приложения) |

Журнал запросов Caddy выключен намеренно: в query-параметрах есть координаты пользователей. Backend по той же причине пишет в журнал только метод и путь запроса, без параметров и IP-адреса клиента. Журналы всех контейнеров ротируются: не больше пяти файлов по 10 МБ на сервис (`x-logging` в `compose.prod.yaml`). Из остальных записей Caddy (например, об ошибке 502, пока backend перезапускается) удаляется заголовок `X-Max-Bot-Api-Secret` с секретом webhook. Заголовок `X-Frame-Options` не ставится, потому что веб-версия MAX открывает мини-приложение в iframe с другого домена. Лимит тела запроса 11 МБ чуть больше лимита загрузки фото (10 МБ).

## 1. Требования к серверу

- VPS у российского провайдера, например Selectel, Timeweb Cloud, Yandex Cloud или VK Cloud. Запись и хранение персональных данных граждан России допускаются только в базах на территории России (152-ФЗ, ст. 18, ч. 5), а в базе ППшкин есть дневник питания и геопозиции пользователей.
- Ubuntu 24.04 LTS.
- 2 vCPU и 4 ГБ RAM: обработка изображений, Node и PostgreSQL на одной машине.
- 30 ГБ SSD.
- Публичный IPv4.
- Docker Engine и плагин Compose не ниже 2.24 (нужен для `env_file` с `required`). Установка по официальной инструкции <https://docs.docker.com/engine/install/ubuntu/>, проверка:

```bash
docker version
docker compose version
```

- Открытые порты: 80/tcp для выпуска сертификата и перенаправления на HTTPS, 443/tcp и 443/udp для HTTPS (включая HTTP/3) и webhook MAX, который доставляется только на 443.

## 2. Домен и DNS

Создайте у регистратора A-запись домена сервиса `hackathon.easymythic.dev` на публичный IPv4 сервера и дождитесь, пока она станет видна:

```bash
dig +short hackathon.easymythic.dev
```

Команда должна вывести IP сервера. Запускайте Caddy только после этого: пока запись не видна, каждая попытка выпуска сертификата заканчивается ошибкой, и Let's Encrypt быстро упирается в лимиты неудачных проверок домена.

## 3. Подготовка сервера

Отдельный пользователь для деплоя с доступом к Docker (команды выполняются под администратором сервера):

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo install -m 600 -o deploy -g deploy ~/.ssh/authorized_keys /home/deploy/.ssh/authorized_keys
```

Проверьте вход `ssh deploy@<IP сервера>` по ключу в отдельном окне и только после этого отключите вход по паролю для всех пользователей. Root тоже входит только по ключу: у пользователя `deploy` нет `sudo`, и без этого на сервере не останется входа для администрирования.

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' | sudo tee /etc/ssh/sshd_config.d/10-ppshkin.conf
sudo sshd -t
sudo systemctl reload ssh
```

Брандмауэр `ufw`:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
sudo ufw status verbose
```

Docker открывает опубликованные порты контейнеров в обход `ufw`, поэтому в `compose.prod.yaml` порты публикует только `caddy`, а backend и база объявлены через `expose`.

Автоматические обновления безопасности:

```bash
sudo apt-get update
sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

Каталог сервиса `/opt/ppshkin`, владелец `deploy`:

```bash
sudo install -d -o deploy -g deploy /opt/ppshkin /opt/ppshkin/deploy /opt/ppshkin/backups
```

Дальше все команды выполняются от пользователя `deploy` (`ssh deploy@<IP сервера>`) в каталоге `/opt/ppshkin`. Скачайте `compose.prod.yaml` и `deploy/Caddyfile` из репозитория:

```bash
cd /opt/ppshkin
curl -fsSL -o compose.prod.yaml https://raw.githubusercontent.com/blsssss/PPshkin/main/compose.prod.yaml
curl -fsSL -o deploy/Caddyfile https://raw.githubusercontent.com/blsssss/PPshkin/main/deploy/Caddyfile
```

## 4. Файл `.env`

Переменные:

| Переменная | Где задаётся | Значение |
|---|---|---|
| `DOMAIN` | `.env` на сервере | домен сервиса, `hackathon.easymythic.dev` |
| `ACME_EMAIL` | `.env` | почта для уведомлений Let's Encrypt |
| `IMAGE_TAG` | `.env` | `latest` или `sha-<7 символов коммита>` |
| `POSTGRES_USER`, `POSTGRES_DB` | `.env` | `ppshkin` |
| `POSTGRES_PASSWORD` | `.env`, обязательна | `openssl rand -hex 24` |
| `MAX_BOT_TOKEN` | `.env`, обязательна | токен бота от организаторов |
| `MAX_WEBHOOK_SECRET` | `.env`, обязательна | `openssl rand -hex 32` (подходит под `^[A-Za-z0-9_-]{5,256}$`) |
| `SESSION_SECRET` | `.env`, обязательна | `openssl rand -hex 32` |
| `CHADGPT_API_KEY` | `.env` | ключ ChadGPT |
| `DEMO_MODE`, `DEMO_GUEST_TOKEN`, `DEMO_VENUE_TOKEN` | `.env` | `true` на период проверки, токены `openssl rand -hex 24` |
| `PROACTIVE_OFFERS` | `.env` | `false` |
| `LOG_LEVEL` | `.env` | `info` |
| `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `TRUST_PROXY=1`, `PUBLIC_BASE_URL=https://${DOMAIN}`, `DATABASE_URL=postgres://${POSTGRES_USER}@db:5432/${POSTGRES_DB}`, `PGPASSWORD=${POSTGRES_PASSWORD}` | `environment` в `compose.prod.yaml` | фиксированы |
| `BOT_MODE` | `environment` в `compose.prod.yaml` | `${BOT_MODE:-webhook}`, в CI `off` |

Без `DOMAIN`, `ACME_EMAIL` и `POSTGRES_PASSWORD` команда `docker compose` сразу останавливается с сообщением, какую переменную задать. Без `MAX_BOT_TOKEN`, `MAX_WEBHOOK_SECRET` и `SESSION_SECRET` в режиме `webhook` backend не запускается и выводит в лог контейнера имя недостающей переменной. Демо-токены из локального `compose.yaml` (с префиксом `local-demo-`) в режиме `webhook` отклоняются.

Создайте файл сразу со сгенерированными секретами и закрытыми правами:

```bash
cd /opt/ppshkin
umask 077
cat > .env <<EOF
DOMAIN=hackathon.easymythic.dev
ACME_EMAIL=<почта для Let's Encrypt>
IMAGE_TAG=latest
POSTGRES_USER=ppshkin
POSTGRES_DB=ppshkin
POSTGRES_PASSWORD=$(openssl rand -hex 24)
MAX_BOT_TOKEN=
MAX_WEBHOOK_SECRET=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
CHADGPT_API_KEY=
DEMO_MODE=true
DEMO_GUEST_TOKEN=$(openssl rand -hex 24)
DEMO_VENUE_TOKEN=$(openssl rand -hex 24)
PROACTIVE_OFFERS=false
LOG_LEVEL=info
EOF
chmod 600 .env
nano .env
```

В редакторе подставьте домен, почту, `MAX_BOT_TOKEN` и `CHADGPT_API_KEY`. Токены не передавайте аргументами команд, чтобы они не попали в историю shell.

Правила:

- Не копируйте на сервер `.env.example` целиком: он для локального запуска. Переменные `BOT_MODE`, `DATABASE_URL`, `TRUST_PROXY` и `PUBLIC_BASE_URL` задаёт `compose.prod.yaml`. Строка `BOT_MODE=...` в `.env` подменит режим `webhook`, поэтому её в серверном `.env` быть не должно.
- `SESSION_SECRET` и `POSTGRES_PASSWORD` после первого запуска не меняйте: смена `SESSION_SECRET` разлогинит всех пользователей, а пароль базы записан в её томе при создании.
- Секреты не пересылайте в открытых чатах и не коммитьте. Файл `.env` читает только владелец (`chmod 600`).

## 5. Первый запуск

```bash
cd /opt/ppshkin
docker compose -f compose.prod.yaml config --quiet
docker compose -f compose.prod.yaml up -d --wait
docker compose -f compose.prod.yaml ps
```

`up --wait` скачивает образы, поднимает базу, применяет миграции и ждёт, пока backend и мини-приложение станут здоровыми. В выводе `ps` порты опубликованы только у `caddy`.

Проверки:

```bash
curl -fsS https://hackathon.easymythic.dev/health
curl -fsS https://hackathon.easymythic.dev/ready
curl -sSI http://hackathon.easymythic.dev/health
docker compose -f compose.prod.yaml logs backend
```

- `https://<домен>/health` и `https://<домен>/ready` отвечают 200 с доверенным сертификатом (без `-k`).
- `http://<домен>/health` отвечает 308 с перенаправлением на HTTPS.
- `https://<домен>/docs` в браузере открывает Swagger UI.
- В логе backend нет ошибок конфигурации, есть `database migrations checked` и `max bot started`.

Если сертификат не выпустился, смотрите `docker compose -f compose.prod.yaml logs caddy`: чаще всего A-запись ещё не видна или закрыт порт 80.

## 6. Webhook MAX

Подписка создаётся автоматически при старте backend в режиме `webhook` (#9): backend подписывается на `https://<домен>/max/webhook` с секретом `MAX_WEBHOOK_SECRET` и удаляет подписки на другие адреса. Задача `max_webhook_guard` каждые 10 минут проверяет подписку и восстанавливает её, если подписки нет или в ней не хватает типов `bot_started`, `message_created`, `message_callback`, `bot_stopped`. Подписка пропадает, например, когда кто-то запускает long polling с тем же токеном или когда MAX отписывает бота после долгих ошибок доставки.

Проверка: живая проверка `max.webhook` ([smoke.md](smoke.md)) или лог backend:

```bash
docker compose -f compose.prod.yaml logs backend | grep -E 'max bot started|max transport started|webhook subscription restored'
docker compose -f compose.prod.yaml exec backend node -e "fetch('https://platform-api2.max.ru/subscriptions', { headers: { authorization: process.env.MAX_BOT_TOKEN } }).then((response) => response.text()).then(console.log)"
```

Второй запрос показывает текущие подписки бота: в списке должен быть `https://<домен>/max/webhook` со всеми четырьмя типами. Запросы к API MAX выполняются из контейнера backend: сертификат `platform-api2.max.ru` выдан удостоверяющим центром Минцифры, которого нет в системном хранилище Ubuntu, а в образе backend он подключён. Токен при этом берётся из окружения контейнера и не попадает в командную строку сервера.

Чтобы проверить восстановление, удалите подписку и подождите: не позже чем через 10 минут в логе появится `webhook subscription restored`.

```bash
docker compose -f compose.prod.yaml exec backend node -e "fetch('https://platform-api2.max.ru/subscriptions?url=' + encodeURIComponent(process.env.PUBLIC_BASE_URL + '/max/webhook'), { method: 'DELETE', headers: { authorization: process.env.MAX_BOT_TOKEN } }).then((response) => response.text()).then(console.log)"
```

Не запускайте long polling (локальный `npm run dev` или `compose.yaml` с `BOT_MODE=polling`) с токеном рабочего бота: при старте в режиме polling backend удаляет все подписки webhook, и рабочий бот молчит до следующей проверки `max_webhook_guard`. Для разработки нужен отдельный бот.

Требования MAX к webhook:

- HTTPS только на порт 443, порт в адресе не указывается;
- доверенный сертификат с полной цепочкой (Let's Encrypt через Caddy подходит), самоподписанные сертификаты не принимаются;
- ответ 200 не позже чем через 30 секунд;
- при ошибке MAX повторяет доставку до 10 раз: первая попытка через 60 секунд, затем интервал растёт с множителем 2,5;
- если за 8 часов не было ни одного успешного ответа, MAX отписывает бота.

## 7. Мини-приложение в MAX

1. Откройте платформу для партнёров `https://business.max.ru/self` (или мини-приложение «MAX для бизнеса» `https://max.ru/business_bot?startapp`).
2. Откройте «Чат-боты», нажмите «Перейти» и выберите бота.
3. Откройте меню из трёх точек и выберите «Настройки».
4. Вставьте адрес мини-приложения `https://<домен>/`, выберите кнопку запуска «Открыть» и нажмите «Сохранить».

Требования к адресу: только `https://`, до 1024 символов, без пробелов. Указывайте корень домена без пути: мини-приложение и API работают на одном домене.

После регистрации включите кнопки открытия мини-приложения в сообщениях бота: `MINI_APP_ENABLED=true` в `.env`, затем `docker compose -f compose.prod.yaml up -d --wait`. Проверьте запуск из чата с ботом в мобильном приложении MAX и в веб-версии `https://web.max.ru`: мини-приложение загружается и входит без ошибок.

## 8. Переменные репозитория GitHub

В Settings, Secrets and variables, Actions, вкладка Variables задайте переменные репозитория:

| Переменная | Значение | Для чего |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://<домен>` | живые проверки ([smoke.md](smoke.md)) |
| `MAX_BOT_USERNAME` | имя бота без `@` | аргумент сборки `VITE_MAX_BOT_NAME` образа мини-приложения и живые проверки |
| `DEMO_MODE` | `true` на период проверки, потом `false` | аргумент сборки `VITE_DEMO_MODE` образа мини-приложения |

Секреты живых проверок (`MAX_BOT_TOKEN`, `CHADGPT_API_KEY`, `DEMO_GUEST_TOKEN`, `DEMO_VENUE_TOKEN`) задаются на вкладке Secrets, список и значения в [smoke.md](smoke.md).

`MAX_BOT_USERNAME` и `DEMO_MODE` попадают в образ мини-приложения при сборке, поэтому после их изменения запустите workflow `publish` вручную (Actions, publish, Run workflow) и обновите сервис по разделу 9.

Workflow `publish` собирает образы при каждом push в `main` и публикует `ghcr.io/blsssss/ppshkin-backend` и `ghcr.io/blsssss/ppshkin-frontend` с тегами `sha-<7 символов коммита>` и `latest`. После первой публикации сделайте оба пакета публичными (страница пакета в GitHub, Package settings, Change visibility, Public), чтобы сервер скачивал образы без входа в реестр.

## 9. Обновление и откат

Для обновления закрепите версию, которую нужно выкатить, и перезапустите сервис:

```bash
cd /opt/ppshkin
nano .env
docker compose -f compose.prod.yaml pull
docker compose -f compose.prod.yaml up -d --wait
```

В `.env` укажите `IMAGE_TAG=sha-<7 символов коммита>` (тег виден в GHCR и в логе workflow `publish`). С `IMAGE_TAG=latest` команда `pull` берёт последний образ из `main`. Если в новой версии изменились `compose.prod.yaml` или `deploy/Caddyfile`, скачайте их из того же коммита командами из раздела 3, подставив в адрес хеш коммита вместо `main`. Изменения `compose.prod.yaml` применяет `up -d --wait`, а изменённый `deploy/Caddyfile` Caddy читает только при запуске, поэтому после его замены выполните `docker compose -f compose.prod.yaml restart caddy`.

Откат: верните в `.env` предыдущий тег и выполните те же `pull` и `up -d --wait`.

Миграции базы только вперёд. Перед обновлением на версию с новой миграцией сделайте резервную копию (раздел 10). Старая версия backend не запускается на базе с неизвестной ей миграцией, а откатить миграцию новой миграцией нельзя, поэтому откат после такого обновления возможен только восстановлением копии.

## 10. Резервные копии

Ежедневная копия в 03:30 с хранением 7 дней. Добавьте строку в `crontab -e` пользователя `deploy`:

```cron
30 3 * * * cd /opt/ppshkin && docker compose -f compose.prod.yaml exec -T db pg_dump -U ppshkin -Fc ppshkin > /opt/ppshkin/backups/ppshkin-$(date +\%F).dump && find /opt/ppshkin/backups -name 'ppshkin-*.dump' -mtime +7 -delete
```

Копии на том же сервере не спасают от потери сервера, поэтому выгружайте их и в объектное хранилище в России (например, S3-совместимое хранилище Selectel, Yandex Object Storage или VK Cloud) отдельной строкой cron после создания копии, например через `rclone copy /opt/ppshkin/backups <хранилище>:ppshkin-backups`.

Восстановление в рабочую базу (backend на это время останавливается):

```bash
cd /opt/ppshkin
docker compose -f compose.prod.yaml stop caddy frontend backend
docker compose -f compose.prod.yaml exec -T db pg_restore -U ppshkin -d ppshkin --clean --if-exists < backups/ppshkin-<дата>.dump
docker compose -f compose.prod.yaml up -d --wait
```

Один раз после настройки проверьте восстановление на отдельной базе, не трогая рабочую:

```bash
cd /opt/ppshkin
docker compose -f compose.prod.yaml exec -T db createdb -U ppshkin ppshkin_restore_check
docker compose -f compose.prod.yaml exec -T db pg_restore -U ppshkin -d ppshkin_restore_check --clean --if-exists < backups/ppshkin-<дата>.dump
docker compose -f compose.prod.yaml exec -T db psql -U ppshkin -d ppshkin_restore_check -c 'select count(*) from users'
docker compose -f compose.prod.yaml exec -T db dropdb -U ppshkin ppshkin_restore_check
```

Если в `.env` заданы другие `POSTGRES_USER` или `POSTGRES_DB`, подставьте их вместо `ppshkin` во всех командах этого раздела.

## 11. Эксплуатация

```bash
cd /opt/ppshkin
docker compose -f compose.prod.yaml ps
docker compose -f compose.prod.yaml logs -f backend
docker compose -f compose.prod.yaml logs -f caddy
```

- После каждого обновления запустите живые проверки вручную: Actions, smoke, Run workflow или `gh workflow run smoke.yml -f checks=all`; порядок, стоимость и чек-лист ручной проверки в [smoke.md](smoke.md).
- Тома `caddy_data` (сертификаты) и `pgdata` (база) не удаляйте: без `caddy_data` Caddy выпускает сертификаты заново и может упереться в лимиты Let's Encrypt. Команду `down --volumes` на сервере не используйте.
- На период проверки хакатона `DEMO_MODE=true` с собственными токенами `DEMO_GUEST_TOKEN` и `DEMO_VENUE_TOKEN` (не `local-demo-...`). После завершения задайте `DEMO_MODE=false`, удалите строки `DEMO_GUEST_TOKEN` и `DEMO_VENUE_TOKEN` (backend не запустится с токенами при выключенном демо-режиме), поменяйте переменную репозитория `DEMO_MODE` на `false`, пересоберите образы через `publish` и обновите сервис по разделу 9.
