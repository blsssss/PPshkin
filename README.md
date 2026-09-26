# ППшкин

Сервис для кафе, кофеен и пекарен в MAX: превращает непроданные позиции и свободные часы в продажи через персональные предложения гостям, которые ведут дневник питания в чат-боте.

## Запуск

```bash
cp .env.example .env
docker compose up -d --wait --build
```

- мини-приложение: http://localhost:8080 (вне MAX показывает экран «Откройте ППшкин в MAX»);
- API: http://localhost:3000, документация http://localhost:3000/docs.

Мини-приложение для разработки:

```bash
cd frontend
npm ci
npm run dev
```

Vite открывает http://localhost:5173 и проксирует `/api` на бэкенд `http://127.0.0.1:3000`. Вне MAX приложение входит под демо-гостем, если в `.env` заданы `DEMO_MODE=true`, `DEMO_GUEST_TOKEN` и то же значение в `VITE_DEV_TOKEN`.

Внешняя зависимость времени выполнения: скрипт MAX Bridge `https://st.max.ru/js/max-web-app.js`, подключается с CDN MAX.
