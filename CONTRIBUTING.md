# Как вносить изменения

## Ветки и pull request

- Ветка `main` защищена: прямые push запрещены, изменения попадают только через pull request.
- Ветку называем по типу изменения: `feat/...`, `fix/...`, `chore/...`, `docs/...`, `test/...`.
- Каждый pull request содержит тесты на то, что он меняет.
- Слияние возможно только после зелёной проверки `ci`. Способ слияния один: squash.
- Заголовок pull request становится сообщением коммита в `main`, поэтому пишем его в формате Conventional Commits: `feat(api): add venue analytics`.

## Проверки перед push

Из каталога `backend`:

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

`npm run format` приводит код к стилю Prettier.

## Стиль

- TypeScript в строгом режиме, ESLint с правилами `strictTypeChecked`.
- Код без комментариев: смысл передают имена, типы и тесты.
- Зависимости фиксируются точными версиями, `package-lock.json` коммитится.
- Секреты хранятся только в `.env` и в секретах GitHub Actions, в репозиторий не попадают.
