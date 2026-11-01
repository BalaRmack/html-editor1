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

---

## 7. Обновление: ошибки загрузки и свой установщик

### 7.1. Загрузка больше не «притворяется успешной»

Раньше прерванное скачивание заканчивалось кнопкой «Играть» — запуск падал уже в игре. Теперь:

| Что | Как |
|---|---|
| Ошибки скачивания | `try/catch` вокруг assets/libraries/natives + `TaskRoutine` → `InstallRunResult { ok, code, message, file, stage, retryable, report }` |
| Реальный текст ошибки | `AppError`/`toFailure` разбирают сообщение xmcl, вытаскивают URL и имя файла (`Ошибка сети. Не удалось скачать файл «client-1.21.4.jar»`) |
| Тост | красный sticky-тост с текстом ошибки и кнопкой «Повторить» (`ToastHost` + `ToastItem.action`) |
| Проверка целостности | `install.verify` → `checkIntegrity()`: client jar, библиотеки, нативы, index + все объекты ассетов; отчёт `IntegrityReport` |
| Кнопка «Играть» | активна только при `integrity[id].status === 'ok'`; иначе — disabled CTA «Ошибка загрузки» + карточка «Файлы игры не скачаны» (первые 3 файла, «Проблемных файлов: N») и «Повторить загрузку» / «Проверить снова» |
| Повтор | `retryInstall` переиспользует уже созданный инстанс, докачивает только недостающее |
| Отмена | не считается ошибкой: статус `unknown`, тоста нет |

Скриншоты: `docs/screens/download-error.png`, `docs/screens/download-failed-toast.png`.
Тесты: `tests/integrity.test.ts` (9), `tests/download-errors.test.tsx` (4), плюс гейтинг в `ui.test.tsx` / `create-instance.test.tsx`.

### 7.2. Установщик и деинсталлятор в стиле Verdant

`electron-builder` → NSIS 3, assisted-режим. Внешний каркас мастера остаётся нативным (иначе ломаются UAC,
тихие обновления и системные кнопки), но всё содержимое перерисовано:

- `build/installer/generate.py` рендерит битмапы (Inter, тёмный фон `#0B0D0C`, изумрудные акценты):
  `installerSidebar.bmp` / `uninstallerSidebar.bmp` 164×314, `installerHeader.bmp` / `uninstallerHeader.bmp` 150×57, `logo.bmp` 56×56;
- `build/installer.nsh` (через `nsis.include`) задаёт тему MUI: `MUI_BGCOLOR`/`MUI_TEXTCOLOR` — тёмные страницы,
  `MUI_INSTFILESPAGE_COLORS` + `MUI_INSTFILESPAGE_PROGRESSBAR colored` — изумрудный прогресс-бар на тёмном фоне;
- приветствие и финиш — с текстами Verdant, на финише галочка «Запустить Verdant Launcher»;
- **деинсталлятор**: своя страница «Удаление Verdant Launcher» с галочкой «Удалить настройки и сохранения»
  (+ подпись `%APPDATA%\Verdant`) и кнопками «Удалить» / «Отмена»; данные удаляются только если галочка стоит
  (`customUnInstall` → `RMDir /r "$APPDATA\Verdant"`), иначе настройки и миры остаются;
- шрифт скрипта — UTF-8 с BOM (иначе NSIS на Windows теряет кириллицу).

Проверки: `tests/installer.test.ts` (6) — размеры битмапов, соответствие `electron-builder.yml`, BOM, наличие удаления данных;
скрипт собран настоящим `makensis` (Linux-сборка NSIS 3.13) в MUI-мастер — 0 ошибок и предупреждений.
Полная сборка `.exe` идёт на Windows-раннере (job `installer` в CI) и в Release-workflow.

Превью: `docs/screens/installer-welcome.png`, `installer-progress.png`, `installer-finish.png`, `uninstaller.png`.

**Сборка проверена на Windows-раннере:** job `Windows installer (NSIS wizard)` в CI компилирует
установщик настоящим `makensis` (NSIS 3.0.4.1) и публикует артефакт `verdant-launcher-setup` (116 МБ) —
`Verdant-Launcher-1.0.0-Setup.exe`. Первые прогоны падали на `warning 6001` (electron-builder собирает
с `-WX`, любое предупреждение — ошибка); исправлено инициализацией всех переменных скрипта в обоих проходах.
