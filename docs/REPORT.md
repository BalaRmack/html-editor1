# Verdant Launcher 1.0.0 — отчёт

**Релиз:** https://github.com/BalaRmack/html-editor1/releases/tag/v1.0.0
**Установщик:** `Verdant-Launcher-1.0.0-Setup.exe` (122 МБ, NSIS, x64)
Прямая ссылка: https://github.com/BalaRmack/html-editor1/releases/download/v1.0.0/Verdant-Launcher-1.0.0-Setup.exe

Ветка: `arena/6413909d-html-editor1` · коммит релиза: `2798234`

---

## 1. Что сделано

| Блок | Статус | Детали |
|---|---|---|
| Оболочка Electron | ✅ | `contextIsolation: true`, `nodeIntegration: false`, CSP, запрет навигации/`window.open`, single-instance, трей при запущенной игре, frameless-окно с кастомным титлбаром |
| Frontend | ✅ | React 18 + TypeScript strict + Vite 7, Tailwind 4 + SCSS, Zustand, Framer Motion, lucide-react, шрифты Inter + Press Start 2P локально (без CDN) |
| Offline-аккаунт | ✅ | валидация ника, UUID = MD5(`OfflinePlayer:<ник>`) с патчем RFC-4122 v3 — проверено тестом против эталона Java |
| Инстансы | ✅ | изоляция `instances/<uuid>/minecraft`, `instance.json`, создание/клонирование/переименование/удаление/иконка, общий кеш `shared/` |
| Ядро запуска | ✅ | Vanilla / Fabric / Quilt / Forge / NeoForge, нативы, classpath, проверка целостности, crash-report, лог в реальном времени |
| Java | ✅ | поиск в реестре Windows + стандартные пути + PATH + `~/.jdks` + `/usr/lib/jvm`, ручной выбор, автоскачивание JRE Mojang |
| Моды | ✅ | Modrinth API (поиск, версии, зависимости, установка 1 клик), CurseForge через API-ключ, включение/отключение, удаление, импорт `.mrpack` и CurseForge-манифестов |
| Скины | ✅ | загрузка PNG 64×64 / 64×32, canvas-рендер модели (спереди/сзади/голова), локальное хранение |
| ОЗУ / JVM | ✅ | слайдер с цветовой индикацией, пресеты, продвинутые аргументы, G1GC по умолчанию, разбор кавычек |
| Консоль | ✅ | цвета ERROR/WARN/INFO/DEBUG, автоскролл, фильтры, «копировать всё», буфер 5000 строк + файл |
| CI/CD | ✅ | CI (typecheck + юнит + UI + сборка + живые API-тесты) и Release (тег → NSIS → GitHub Release) |
| Иконка / ярлыки | ✅ | ICO 16–256 (BMP-энтри + PNG 256), ярлыки на Рабочем столе и в «Пуск», выбор папки установки |

Языки интерфейса: **русский + английский** (переключатель в настройках). Данные по умолчанию: `%APPDATA%\Verdant\data` (меняется в настройках).

---

## 2. Зависимости (финальные)

**Runtime (попадают в установщик)**

| Пакет | Версия | Зачем |
|---|---|---|
| `@xmcl/core` | 2.15.1 (pin) | версии, аргументы запуска, classpath, нативы, pre-checks |
| `@xmcl/installer` | 6.0.0 (pin) | Vanilla/Fabric/Quilt/Forge/NeoForge + post-processors |
| `@xmcl/task` | 4.1.1 | прогресс установки |
| `adm-zip` | ^0.5.16 | чтение `.mrpack` / CurseForge-архивов |

**Dev (бандлятся в renderer, не нужны в рантайме)**
`react` 18.3.1, `react-dom`, `zustand` 5, `framer-motion` 14, `lucide-react` 1, `clsx`, `@fontsource-variable/inter`, `@fontsource/press-start-2p`,
`electron` 45.2.1, `electron-vite` 5, `vite` 7.3.7, `@vitejs/plugin-react` 5.1, `tailwindcss` 4.3.3 + `@tailwindcss/vite`, `sass` 1.107,
`electron-builder` 26.18, `typescript` 5.9.3, `vitest` 5, `jsdom` + `@testing-library/*`.

**Почему не `minecraft-launcher-core`:** заброшен с декабря 2024, тянет deprecated `request`,
не умеет NeoForge/Quilt и не выполняет post-processors Forge (новые версии Forge просто не стартуют).
`@xmcl/core` — актуальная референсная реализация (её использует XMCL), обновляется в 2026.

**Про пины:** `@xmcl/core@2.16.x` и `@xmcl/installer@6.3.x` в npm **сломаны** — зависимость
`@xmcl/unzip` объявлена как `workspace:^*`, из-за чего `npm i` падает с `EUNSUPPORTEDPROTOCOL`.
Поэтому зафиксированы рабочие 2.15.1 / 6.0.0 (проверено на чистой установке и в CI).

---

## 3. Проверка (что реально прогнано)

| Проверка | Результат |
|---|---|
| `npm run typecheck` (main, preload, renderer, tests — strict) | ✅ без ошибок |
| `npm run test` — 17 юнит-тестов | ✅ UUID offline (`Notch` → `b50ad385-…ba7f`), maven-парсер, сортировка версий, NeoForge-префиксы, JVM-аргументы, токенизатор кавычек, PNG-заголовки, эвристика Java |
| `npm run test:ui` — 4 smoke-теста в jsdom | ✅ загрузка экрана Play, навигация по всем 6 экранам, сохранение ника, каталог модов |
| `npm run build:only` | ✅ `out/main`, `out/preload`, `out/renderer` |
| CI job «Live API integration» (windows-latest) | ✅ реальные запросы: скачивание `version.json` + `client.jar` Minecraft **1.20.1** с Mojang, `Version.parse`, сборка командной строки Java; списки Fabric/Forge/NeoForge; поиск и версии модов Modrinth |
| Release workflow | ✅ NSIS `.exe` собран, asar проверен скриптом (наличие `out/main`, `out/preload`, `out/renderer`, `@xmcl/*`, `adm-zip`, иконки), релиз опубликован |

Тесты нашли три настоящих бага, которые исправлены: разбор JVM-аргументов с кавычками внутри токена,
дублирование строк лога (история + live-поток), повторная подписка store в React StrictMode.

---

## 4. Как запустить локально

```bash
git clone https://github.com/BalaRmack/html-editor1.git
cd html-editor1
git checkout v1.0.0          # или main
npm ci
npm run dev                  # Electron + HMR
```

Полезно:

```bash
npm run preview:ui                       # интерфейс в браузере (mock-бэкенд, порт 4173)
npm run test && npm run test:ui          # тесты
VERDANT_NET_TESTS=1 npx vitest run tests/network.test.ts   # живые API-тесты
npm run package                          # локальная сборка установщика (Windows)
```

Сборка релиза:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

---

## 5. Структура (кратко)

```
src/shared/   типы + контракт IPC + константы
src/preload/  contextBridge → window.launcher (фиксированный API, без generic invoke)
src/main/     ipc/ (валидация, единый формат ошибок) + services/
              paths config-store offline profile instances versions net java
              installer launch modrinth curseforge mods logger tasks
src/renderer/ i18n RU/EN, store (Zustand), components, features/{play,instances,mods,skins,settings,console}
```

---

## 6. Ограничения и следующий шаг

1. **Code signing отсутствует** — SmartScreen покажет «Неизвестный издатель». Лечится сертификатом EV
   и переменными `CSC_LINK` / `CSC_KEY_PASSWORD` в secrets; workflow уже совместим.
2. **Только offline-аккаунты** — по ТЗ. Microsoft OAuth не реализован (нужен Azure-клиент и device-code flow).
3. **CurseForge** требует API-ключ пользователя (официальный путь; прокси не использовал). Без ключа доступен Modrinth.
4. **Скины offline** не синхронизируются с Mojang — файл хранится локально, серверы с плагином скинов принимают его отдельно.
5. **Проверка «в живом запуске»** — в этой песочнице нельзя запустить Electron (CDN Electron недоступен),
   поэтому UI проверен jsdom-тестами, сборка — Windows-раннером GitHub Actions, а скачивание игры —
   отдельным CI-джобом с реальными запросами к Mojang. Первый локальный запуск на вашей машине стоит
   сделать через `npm run dev`.
