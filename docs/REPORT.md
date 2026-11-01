# Verdant Launcher — отчёт

**Актуальный релиз: 1.1.0** — https://github.com/BalaRmack/html-editor1/releases/tag/v1.1.0
Установщик: `Verdant-Launcher-1.1.0-Setup.exe` (122 МБ, NSIS, x64, свой мастер).
Прямая ссылка: https://github.com/BalaRmack/html-editor1/releases/download/v1.1.0/Verdant-Launcher-1.1.0-Setup.exe

<details>
<summary>Релиз 1.0.0</summary>

**Релиз:** https://github.com/BalaRmack/html-editor1/releases/tag/v1.0.0
**Установщик:** `Verdant-Launcher-1.0.0-Setup.exe` (122 МБ, NSIS, x64)
Прямая ссылка: https://github.com/BalaRmack/html-editor1/releases/download/v1.0.0/Verdant-Launcher-1.0.0-Setup.exe

Ветка: `arena/6413909d-html-editor1` · коммит релиза: `2798234`
</details>

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
| Обратная связь | ✅ | две иконочные кнопки внизу сайдбара; отчёт об ошибке с системной информацией и последними 100 строками `latest.log`, предложение с необязательным контактом; отправка из main-процесса (webhook / GitHub issue), без редиректа в браузер |
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
| `npm run test:ui` — UI-тесты в jsdom | ✅ загрузка экрана Play, навигация по всем 6 экранам, сохранение ника, каталог модов |
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

---

## 8. Автообновление (Task 1 спринта)

### 8.1. Как решается «показывать баннер или нет»

Отдельный чистый модуль `src/main/services/update-logic.ts` (без `electron`, покрыт `tests/update-logic.test.ts` — 18 тестов):

| Функция | Смысл |
|---|---|
| `parseVersion` / `compareVersions` | `v1.2.3` → `[1,2,3]`, отсутствующие сегменты = 0, prerelease (`-beta.1`) считается **меньше** релиза |
| `normalizeRelease` | GitHub `releases/latest` → `UpdateRelease`; драфты и теги без версии отбрасываются |
| `pickInstallerAsset` | выбирает `*setup*.exe`, игнорируя `.blockmap` и `latest.yml` |
| `decideUpdate` | единственное правило: `notify` / `skipped` / `deferred` / `up-to-date` |

### 8.2. Сервис в main-процессе (`src/main/services/updater.ts`)

- при старте и далее **раз в час** (`CHECK_INTERVAL_MS = 1h`) — `GET https://api.github.com/repos/BalaRmack/html-editor1/releases/latest`
  (хост переопределяется `VERDANT_GITHUB_API`, это использует CI-тест);
- `electron-updater` (`autoDownload = false`) скачивает и проверяет `latest.yml` + `.blockmap`; в dev-режиме
  тот же прогресс показывается обычной HTTP-загрузкой в `<cacheDir>/updates`;
- сетевой сбой **не прячет** уже показанный баннер: сохраняется последний `release`;
- «Отложить» — в памяти (`deferredTag`, сбрасывается при следующем запуске), «Не скачивать эту версию» —
  в `electron-store` (`updates.skippedVersion`), живёт после перезапуска и снимается только для новой версии;
- IPC: `updates.state|check|download|install|defer|skip|resume` + push-событие `updates:changed`.

### 8.3. Баннер

`src/renderer/src/features/UpdateBanner.tsx` — стеклянная карточка в правом нижнем углу (портал в `body`,
`fixed bottom-6 right-6`, `z-40`), фазы `available → downloading → ready / error`:

- «Установить» → прогресс-бар (`percent`, `МБ / МБ`, скорость) → «Перезапустить и установить» (`quitAndInstall`);
- «Отложить» → баннер прячется до следующего запуска;
- «Не скачивать эту версию» → `updates.skip`, версия больше никогда не предлагается;
- «Что нового» → `app.openExternal(htmlUrl)`;
- `ToastHost` поднимается на `bottom-[236px]`, пока баннер виден, чтобы тосты не наезжали.

Скриншоты: `docs/screens/update-available.png`, `update-downloading.png`, `update-ready.png` (+ `update-idle.png`).
Проверка: `tests/update-logic.test.ts` — 18 тестов; `npx electron-vite build` — зелёный.

---

## 9. Контент-менеджер инстанса (Task 2 спринта)

Кнопка «Настроить» на карточке сборки открывает окно в стиле Verdant (стекло, изумруд, Framer Motion):
слева — разделы, в центре — таблица, справа — действия. `src/renderer/src/features/ContentManager.tsx`.

| Раздел | Что внутри |
|---|---|
| **Логи** | последние 100 строк сессии (`store.logs`), уровни подсвечены |
| **Версии** | версия игры, загрузчик + версия, дата последнего запуска, состояние файлов, путь сборки |
| **Modrinth** | каталог с поиском под эту сборку (моды / ресурспаки / шейдеры) |
| **Моды / Ресурспаки / Шейдеры** | таблица: чекбокс, название, версия, дата, автор, статус |

### 9.1. Главное требование: 100 % совместимость

Правило живёт в чистом модуле `src/main/services/content-logic.ts` (без `electron`, 24 теста в
`tests/content-logic.test.ts`):

- `versionMatches` — точное совпадение версии игры (`1.21` **не** подходит для `1.21.4`);
- `loaderMatches` — Fabric-мод не попадёт в Forge; Quilt принимает Fabric, обратное — нет;
- `isCompatible` / `filterCompatible` — фильтр «версия + загрузчик» для модов, «версия» для паков и шейдеров;
- `pickCompatibleVersion` — самый свежий билд, который всё ещё поддерживает инстанс;
- `isNewerBuild` — обновление, если другой `versionId` **или** другой SHA-1 (тихая пересборка того же номера тоже ловится).

Соблюдение на уровне main-процесса: `modsService.searchContent()` сам подставляет
`instance.mcVersion` и `instance.loader` в запрос (Modrinth facets `versions:` / `categories:`,
CurseForge `gameVersion` + `modLoaderType`, classId 6/12/6552) и **повторно** фильтрует ответ.
Renderer не может запросить несовместимый каталог — параметров для этого в IPC просто нет.

### 9.2. Установка и зависимости

`api.content.install` → `modsService.installContent`: для модов переиспользуется старый
`installRecursive` (обязательные зависимости ставятся автоматически, глубина ≤ 6, повторно не качаются),
для паков и шейдеров — загрузка в `resourcepacks/` / `shaderpacks/`. В `mods.json` теперь пишутся
`kind`, `versionId`, `sha1`, `author` — из них строится таблица и проверка обновлений.

### 9.3. «Проверить обновления»

`api.content.updates(instanceId, kind)` перебирает записи манифеста, спрашивает у источника свежие версии
для этой сборки и сравнивает `versionId` + SHA-1. Обновлённые строки получают золотой бейдж «Обновление»,
в таблице видно `0.6.5 → 1.2.0`, справа — кнопка «Обновить». Применение (`api.content.update`) качает новый
файл, удаляет заменённый и обновляет манифест.

### 9.4. Действия

Удалить, Включить/Отключить (`name.jar` ⇄ `name.jar.disabled`), Открыть папку, Открыть страницу проекта
(Modrinth/CurseForge по типу контента). Всё — в правой панели, с иконками lucide, без эмодзи.

Скриншоты: `docs/screens/content-mods.png`, `content-updates.png`, `content-updated.png`,
`content-catalog.png`, `content-versions.png`, `content-logs.png`, `content-resourcepacks.png`.
Тесты: `tests/content-logic.test.ts` (24) + `tests/content-manager.test.tsx` (4, jsdom).
`npx electron-vite build` — зелёный.

## 10. Обратная связь: «Сообщить об ошибке» и «Предложить улучшение» (Task 3 спринта)

### 10.1. Точка входа

В самом низу левого сайдбара, под разделителем, две круглые иконочные кнопки (`Bug` и `Lightbulb` из
lucide-react, **без эмодзи**). Подписи — только в тултипе, который выезжает **вправо** (`side="right"`):
сайдбар шириной 86 px, центрированный тултип обрезался бы за краем экрана. Скриншоты:
`docs/screens/feedback-1-sidebar.png`, `feedback-7-tooltip.png`.

### 10.2. Никакого браузера — отправка из main-процесса

`src/main/services/feedback.ts` (доставка) + `src/main/services/feedback-format.ts` (чистая логика:
`stripAnsi`, `tailLines`, `buildFeedbackBody`). Renderer вызывает только `api.feedback.preview()` и
`api.feedback.send(input)` — внешний переход не нужен вообще.

Порядок доставки:

1. **Webhook** (`settings.feedbackWebhook` или `VERDANT_FEEDBACK_WEBHOOK`) — POST JSON с `content`
   (однострочный заголовок) и полным markdown-отчётом в `embeds`-совместимом виде; работает с
   Discord и Slack.
2. **GitHub issue** — если задан `VERDANT_GITHUB_TOKEN`, отчёт создаётся в `BalaRmack/html-editor1`
   с метками `bug`/`enhancement` + `from-launcher`.
3. Иначе — код `feedback_not_configured`: модалка показывает кнопку «Открыть настройки» и ведёт
   в панель FEEDBACK, где можно вставить вебхук. Плюс всегда доступна кнопка «Скопировать отчёт».

Предохранители: минимум 10 символов, лимит 2000 в textarea, антифлуд 30 с (`feedback_rate_limited`),
таймаут запроса 15 с, ANSI-коды из лога вырезаются перед отправкой.

### 10.3. Что прикладывается автоматически

* **Системная информация** — ОС и разрядность, версия лаунчера и Electron, найденная Java (версия и путь),
  объём ОЗУ, локаль, название текущей сборки. Собирается в main-процессе, пользователь видит её
  в раскрывающемся блоке «Системная информация» до отправки.
* **Последние 100 строк `latest.log`** — читаются с диска (`<logsDir>/launcher.log`, лимит 2 МБ,
  хвост файла), а не из кольцевого буфера памяти, поэтому попадает и сессия, которая только что упала.
  Если файла нет — фолбэк на буфер логгера. Бейдж показывает фактическое число строк.

Окно отчёта об ошибке и окно предложения отличаются: в предложении нет лога, но есть
необязательное поле контакта (Discord/Telegram) — «Нужен только если хотите получить ответ».

### 10.4. Состояния

`preview` → форма; отправка → спиннер; успех → «Отправлено!» + «Приложено строк лога: 100» и кнопка
«Закрыть»; ошибка → красный блок с причиной и кнопкой «Повторить». Модалка закрывается по Esc/клику
по фону, как и остальные.

### 10.5. Проверка

* `tests/feedback.test.ts` — `tailLines` (обрезка до 100, CRLF, ANSI), `buildFeedbackBody`
  (bug/suggestion, обрезка заголовка), валидация ника.
* `tests/feedback-ui.test.tsx` — 3 теста в jsdom: кнопки стоят последними в `nav` и не содержат текста
  (иконки!), модалка ошибки показывает системную информацию и `latest.log`, «Отправить» заблокирована
  до 10 символов и после отправки показывает «Отправлено!», в предложении есть поле контакта и нет лога.
* `Modal` получил `role="dialog"` + `aria-modal` — теперь все модалки доступны скринридеру и тестам.
* Скриншоты: `feedback-1-sidebar.png`, `feedback-2-bug.png` (системная информация),
  `feedback-3-log.png` (100 строк), `feedback-4-sent.png`, `feedback-5-suggestion.png`,
  `feedback-6-settings.png` (панель FEEDBACK в настройках), `feedback-7-tooltip.png`.

## 11. Критические исправления по логу реального запуска

Пользователь прислал `launcher.log` после реальной установки. По нему — четыре исправления (плюс одно,
выведенное из того же лога).

### 11.1. Повреждённый JSON больше не «висит», а перекачивается

В логе: `WARN Не удалось прочитать индекс ассетов 34 … Unexpected token '\u0000'`, после чего установка
вставала навсегда. Причина — `@xmcl` читал уже лежащий на диске битый файл и падал на парсинге, а
`installer` только писал WARN и продолжал.

Появился `src/main/services/json-guard.ts`: `parseJsonGuard` (пустой файл, NUL-байты, мусор в начале,
обрезанный JSON), `dropIfBrokenJson` (удаляет битый файл), `purgeBrokenJsonIn` (обходит каталог: индексы
ассетов и `versions/<id>/`). В `installer.ts`:

* перед установкой — `sanitizeShared()`: чистит `shared/assets/indexes` и `shared/versions/*/*.json`
  (стадия «Проверка локальных файлов»);
* после установки — `findBrokenJson()`; если что-то осталось битым, установка **повторяется один раз**
  (стадия «Повторная загрузка повреждённых файлов»), и только если файл снова битый — `AppError` с кодом
  `json_corrupt` (retryable). Код добавлен в `ErrorCode` и в словари RU/EN: «Файл {file} повреждён и будет
  скачан заново».

`tests/json-guard.test.ts` (10 тестов) проверяет ровно этот сценарий: NUL-индекс удаляется, валидный
файл остаётся, пустой файл считается битым, `purgeBrokenJsonIn` не трогает `.txt` и корректно обходит
`versions/fabric-1.21.4/`.

### 11.2. «Играть» больше не запускает сломанную сборку

Раньше кнопка оставалась активной после «Установка не удалась». Теперь:

* в `store/app.ts` `launch()` до спавна проверяет состояние целостности: если оно неизвестно — сначала
  `checkIntegrity()`; если не `ok` — запуск не происходит, показывается **липкий** тост
  `toast.notReady` с кодом ошибки и действием «Повторить»;
* в `Play.tsx` кнопка действительно `disabled`, пока установка не завершилась успешно (это закреплено
  UI-тестом «locks «Играть» while the integrity check says files are missing»), а не просто «нажимается
  и ничего не делает».

### 11.3. Ник проверяется по-настоящему

`src/shared/validation.ts` — единственный источник правил: `NicknameError` (`empty`, `too_short`,
`too_long`, `invalid_chars`), `NICKNAME_RE = /^[A-Za-z0-9_]{3,16}$/`. Используется и в main-процессе
(`offline.ts` теперь реэкспортирует эти функции вместо своей копии), и в UI. В `ProfileModal.tsx` ник
валидируется на каждый ввод: счётчик символов, подсказка правил, конкретная ошибка под полем, а кнопка
«Сохранить» **disabled**, пока ник невалиден. Это проверено тестами в `tests/feedback.test.ts`.

### 11.4. CurseForge: ключ вводится в настройках

В логе: `[mods:search] Для CurseForge нужен API-ключ`. В настройках появилась панель «Моды и API»:
поле ключа (по типу пароля), бейдж «Ключ сохранён / Ключ не задан», кнопка «Сохранить», кнопка
«Проверить ключ» (реальный `api.mods.search` по CurseForge, результат — «Ключ работает» / «Ключ
отклонён») и ссылка «Получить ключ» на `console.curseforge.com`. Экран «Моды» при отсутствии ключа
показывает не тупиковый текст, а кнопку «Указать ключ», которая открывает нужную панель настроек.

### 11.5. Пустой текст ошибки (`Установка не удалась: `)

`errors.ts` разворачивает `AggregateError` и цепочку `cause`: берётся первое осмысленное сообщение из
`error.errors[].message` (`Headers Timeout Error`, `Connect Timeout Error (… 10000ms)`) или
дружелюбная замена, если сообщения нет вообще. Сетевые ошибки распознаются по расширенному набору
признаков (`UND_ERR_`, `headers timeout`, `body timeout`, `connect timeout`, `aggregateerror`,
`other side closed`), таймаут даёт «Сервер не ответил вовремя» с именем файла. Плюс в `integrity.ts`
сообщение про индекс переформулировано: «…повреждён — будет скачан заново» вместо тупикового WARN.

## 12. Быстрый старт: splash + инкрементальная проверка файлов (Task 4)

### 12.1. Splash-экран

`src/main/splash.ts` + `src/renderer/splash.html`. Окно 420×236, frameless, `skipTaskbar`, показывается
сразу после `app.whenReady()` — **до** чтения конфига, инициализации сервисов и создания главного окна.
Страница — обычный HTML с инлайн-CSS и SVG-логотипом: ни React, ни бандла, поэтому первый кадр рисуется
мгновенно. Статус обновляется из main-процесса (`setSplashStatus`: «Чтение настроек» → «Загрузка
интерфейса»), главное окно забирает эстафету на `ready-to-show`, splash закрывается с минимальной
задержкой 550 мс (чтобы не мигал) и страховочным таймаутом 15 с. Скриншот: `docs/screens/splash.png`.

### 12.2. Проверка целостности: только изменённые файлы

Раньше перед каждым запуском делался `stat()` **каждого** файла (клиент + все библиотеки + все объекты
ассетов), а с `deep` — ещё и sha1 каждого. На 1.21.4 это тысячи обращений к диску на один клик.

Теперь есть `src/main/services/verify-cache.ts`: на инстанс хранится `.verdant-verified.json` —
отпечатки `{size, mtimeMs, sha1}` по каждому файлу. Алгоритм:

| Ситуация | Что делаем |
|---|---|
| Файла нет или он нулевого размера | проблема `missing` |
| Размер не совпал с ожидаемым | проблема `truncated` (читать не нужно) |
| Размер **и** mtime совпали с кэшем | файл не тронут, **чтения нет** |
| Кэша нет (первый прогон после установки) | принимаем по `stat`, запоминаем отпечаток |
| Размер/mtime изменились | читаем файл, сверяем sha1, обновляем отпечаток |

То есть **хешируются только изменившиеся файлы**, а здоровый инстанс после первого прогона
проверяется одними `stat`, но всё равно с гарантией: подменённый байт меняет и mtime, и тогда файл
перечитывается и сравнивается по sha1. Полный хеш-проход доступен явно (`deep`, кнопка «Проверить
файлы» в интерфейсе).

Проверка запускается в фоне и не блокирует окно:

* при старте приложения через 1.2 с после показа окна `warmIntegrityCache()` прогревает кэш для всех
  установленных инстансов последовательно (main-процесс, `src/main/index.ts`);
* `Play.tsx` стартует проверку выбранного инстанса при монтировании экрана;
* `launch()` ждёт результат только если статус ещё `unknown`, и после прогрева это ожидание —
  один проход `stat` без чтения файлов;
* кэш сбрасывается перед установкой (`invalidateVerifyCache`), чтобы старые отпечатки не «подтвердили»
  перезаписанные файлы.

В отчёт `IntegrityReport.counts` добавлены `hashed` и `skipped` — в логе видно, сколько файлов реально
читалось:

`Проверка «fabric-1.21.4»: OK (библиотек 61, ассетов 3120, проверено 3185, хэшировано 0, по stat 3185, 214 мс)`

### 12.3. Проверка

* `tests/verify-cache.test.ts` — 17 тестов на решение по одному файлу (missing, нулевой размер,
  несовпадение размера, тёплый кэш, сдвинутый mtime, `deep`, отсутствие sha1) и на сам проход;
* `tests/integrity-incremental.test.ts` — 7 тестов на реальном временном каталоге: первый прогон
  `hashed = 0` и запись кэша, второй прогон `skipped = checked`, подмена байтов в библиотеке →
  ровно один файл перечитан и найден, ремонт → снова OK, удалённый ассет при тёплом кэше ловится,
  `deep` хеширует всё, битый кэш не ломает проверку, `maxIssues` держит отчёт компактным;
* старые `tests/integrity.test.ts` (9) продолжают проходить без изменений.
