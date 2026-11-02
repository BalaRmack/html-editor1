# Verdant Launcher — отчёт

**Актуальный релиз: 1.1.2** — https://github.com/BalaRmack/html-editor1/releases/tag/v1.1.2
Установщик: `Verdant-Launcher-1.1.2-Setup.exe` (NSIS, x64, свой мастер).
Прямая ссылка: https://github.com/BalaRmack/html-editor1/releases/download/v1.1.2/Verdant-Launcher-1.1.2-Setup.exe

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
* `tests/integrity-incremental.test.ts` — 7 тестов на реальном временном каталоге (mtime в тестах
  выставляется через `utimes`, чтобы результат не зависел от гранулярности файловой системы): первый прогон
  `hashed = 0` и запись кэша, второй прогон `skipped = checked`, подмена байтов в библиотеке →
  ровно один файл перечитан и найден, ремонт → снова OK, удалённый ассет при тёплом кэше ловится,
  `deep` хеширует всё, битый кэш не ломает проверку, `maxIssues` держит отчёт компактным;
* старые `tests/integrity.test.ts` (9) продолжают проходить без изменений.

## 13. Релиз 1.1.2: прогресс, BMCLAPI и скорость загрузки

Пять дефектов из реального запуска и полная переделка загрузчика. Ни один пункт
не «поправлен в рендерере» — причины лежат в main-процессе.

### 13.1. Полоса прогресса больше не идёт назад

`@xmcl` пересчитывает `total` по мере обнаружения новых файлов: на 90 % граф
внезапно сообщал `1400/2000` (70 %), и UI честно рисовал откат. Теперь прогресс
считает `ProgressTracker` (`src/main/services/downloader.ts`):

* `total` фиксируется при первом отчёте фазы — расти он больше не может;
* результат зажимается `Math.max(previous, next)`, то есть даже перекачка файла
  не двигает полосу назад, максимум — короткая пауза;
* установка разбита на фазы со своими отрезками шкалы: манифест 0–3 %,
  клиент 3–38 %, загрузчик 38–55 %, библиотеки и ассеты 55–96 %, финал 96–100 %;
* тот же инвариант продублирован в шине задач (`tasks.ts`), поэтому «назад» не
  может отправить ни один вызывающий код.

### 13.2. BMCLAPI: принудительный обход заблокированных хостов

`piston-data.mojang.com` и `libraries.minecraft.net` из РФ не отвечают — отсюда
`[network_error] Сеть недоступна` на каждом шаге. Добавлен `mirror.ts`:

* таблица замен хост → зеркало: `launchermeta` / `piston-meta` / `piston-data` /
  `launcher.mojang.com` → `bmclapi2.bangbang93.com`, `resources.download…` →
  `/assets`, `libraries.minecraft.net` и все maven-хосты (Fabric, Forge, NeoForge,
  Quilt) → `/maven`, `meta.fabricmc.net` → `/fabric-meta`;
* официальный хост пробуется первым, но два подряд сбоя переводят **всю сессию**
  на зеркало; успешный ответ зеркала закрепляет режим (в 1.2.0 порядок обращён:
  зеркало всегда первое — см. §14.2);
* перед установкой один быстрый пробник (3.5 с) решает, куда идти, — первый же
  запуск в РФ идёт через зеркало, без ожидания таймаутов;
* зеркала прокинуты в `@xmcl` через `fetch`, `mavenHost`, `assetsHost`,
  `assetsIndexUrl`; у Forge/NeoForge URL инсталлятора сразу указывает на
  зеркальный maven, официальный остаётся резервом.

### 13.3. Тост больше не показывает `{file}`

`localizeError` подставляет значения только при наличии `vars`; при сетевой
ошибке без имени файла в UI попадал сам шаблон. Теперь:

* `toFailure` достаёт имя файла из `err.file`, URL или текста сообщения;
* `localizeError` при незаполненном плейсхолдере берёт `errors.<code>.generic`
  («Ошибка сети. Не удалось скачать файлы игры») и никогда не печатает скобки;
* `Play.tsx` использует тот же `localizeError` вместо сырого `t(\`errors.${code}\`)`.

### 13.4. GitHub 403 при проверке обновлений

`api.github.com` отклоняет запросы без User-Agent. В запрос релиза добавлены
`User-Agent: VerdantLauncher`, `Accept: application/vnd.github+json` и
`X-GitHub-Api-Version`, повторов стало два, таймаут — 15 с.

### 13.5. «Отменено» заменено на «Ожидание сети» + «Повторить»

Сетевой сбой больше не выглядит отменой: задача переходит в статус `waiting`,
карточка показывает янтарный бейдж «Ожидание сети», подсказку «Уже скачанное
сохранено — нажмите «Повторить»» и кнопку повтора. Внутри установки каждая фаза
повторяется до трёх раз с паузой, а частичные файлы остаются на диске: повтор
продолжает с того же места.

### 13.6. Скорость

| Что | Было | Стало |
| --- | --- | --- |
| Параллельные загрузки | по одной | пул 16 сокетов (библиотеки, ассеты), 12 (файлы сборки), 8 (CurseForge) |
| Соединения | новое TCP+TLS на файл | один `https.Agent` с keep-alive, 64 сокета, переиспользование TLS-сессии |
| Запись на диск | поток на файл | поток → `.part` → rename, `fs.promises`, без буферизации в RAM |
| Обрыв | файл с нуля | `Range`-докачка `.part` |
| Проверка хэшей | SHA1 всех файлов | сравнение размера, SHA1 только для скачанного (`prevalidSizeOnly`, кэш `downloadHashCache`) |
| Моды | ошибка одного валит установку | `Promise.allSettled` + пул, ошибки собираются пофайлово |
| UI | «…» вместо процентов | один прогресс-бар: процент, МБ/с, ETA |

### 13.7. Проверка

* `tests/download-engine.test.ts` — 15 тестов: монотонность (сценарий 90 % → 70 %),
  отрезки фаз, скорость/ETA, лимитер, изоляция ошибок, вся таблица зеркал,
  реальная Range-докачка и редирект на локальном сервере;
* `tests/error-templates.test.tsx` — шаблон `{file}` не попадает в UI ни с именем
  файла, ни без него;
* итог: node **133 passed / 7 skipped**, UI **27 passed**, `tsc` ×4 чисто,
  `electron-vite build` собирается;
* скриншоты: `docs/screens/progress-speed.png`, `docs/screens/progress-waiting.png`.

## 14. Релиз 1.2.0: свой установщик и принудительный BMCLAPI

Два требования из одного сообщения: «Откажись от стандартных NSIS/Inno Setup.
Реализуй кастомный Bootstrapper на базе Electron» и «Зеркала не добавлены —
принудительно подменяй URL библиотек, ассетов и нативов, официальный хост
отключай за 3–5 секунд». Оба сделаны в одной версии.

### 14.1. Установщик — отдельное Electron-приложение

NSIS удалён целиком: `build/installer.nsh`, битмапы мастера и блок `nsis:` в
`electron-builder.yml`. Лаунчер теперь собирается как **payload**:

```
electron-builder --win --x64 --dir   →  release/win-unpacked/
node scripts/make-payload.mjs        →  dist-payload/app.zip   (~200 МБ)
```

`app.zip` кладётся в `extraResources` второго, крошечного приложения:

| Файл | Роль |
|---|---|
| `installer/main.ts` | frameless-окно 820×560 (`#06110c`), IPC, `--uninstall` / `--silent` / `--wait-pid` |
| `installer/core.ts` | распаковка zip (yauzl), ярлыки через PowerShell, `reg.exe` в `HKCU`, удаление |
| `installer/preload.ts` | только `contextBridge`: start/cancel/minimize/close, подписка на прогресс |
| `installer/renderer/*` | React 18 + Tailwind + Framer Motion: приветствие, прогресс, готово, ошибка, режим удаления |
| `electron.vite.installer.config.ts` | отдельная сборка; `yauzl` бандлится в `main.js` (внешний только `electron`) |
| `electron-builder.installer.yml` | `target: portable`, `files: main.js, preload.js, renderer/**`, `extraResources: app.zip` |
| `scripts/make-payload.mjs` | zip с deflate-потоком и data-дескрипторами: 200 МБ не проходят через RAM |

Этапы и проценты (одна полоса, как в лаунчере): подготовка 0–6, распаковка
6–82, ярлыки 82–92, реестр 92–98, готово 100. Строка этапов
(«Подготовка · Распаковка · Ярлыки · Реестр») подсвечивается по текущей фазе.

Что делает установка:

* распаковка в `%LOCALAPPDATA%\VerdantLauncher` — без прав администратора;
* ярлыки `Desktop\Verdant Launcher.lnk` и меню «Пуск» (PowerShell + `WScript.Shell`);
* запись `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\VerdantLauncher`:
  `DisplayName`, `DisplayVersion`, `Publisher`, `InstallLocation`, `DisplayIcon`,
  `UninstallString` (`"…\Uninstall Verdant Launcher.exe" --uninstall`),
  `QuietUninstallString` (`… --silent`), `NoModify`/`NoRepair`, `EstimatedSize` (КБ);
* удаление — **тот же** exe с `--uninstall`: файлы, ярлыки и запись реестра,
  а `%APPDATA%\Verdant` (сохранения, настройки, библиотеки) стирается только при
  включённой галочке «Удалить сохранения и настройки».

Обновление переписано под новый артефакт: `electron-updater` больше не
вызывается (у portable-exe нет `latest.yml`). Лаунчер скачивает
`Verdant-Launcher-<version>-Setup.exe` из релиза и запускает его с
`--silent --wait-pid <pid>`; установщик ждёт завершения процесса (до 30 с) и
только потом перезаписывает файлы.

Пайплайн (`.github/workflows/release.yml`, `.github/workflows/ci.yml`):
тесты → `typecheck` → `build:only` → `electron-builder --dir` → проверка
содержимого `app.asar` (main/preload/renderer/`@xmcl`/`adm-zip`) → `make-payload`
→ сборка UI установщика → `electron-builder -c electron-builder.installer.yml`
→ проверка размера (`app.zip` ~200 МБ, setup ≥ 60 МБ) → артефакт
`release-installer/*.exe`. NSIS в пайплайне нет ни на одном шаге.

Скриншоты (headless Chromium, 820×560 @2x): `docs/screens/setup-welcome.png`,
`setup-progress.png` (49 %, чип «Распаковка»), `setup-done.png`,
`setup-uninstall.png` (режим удаления с галочкой).

### 14.2. BMCLAPI: подмена до первого запроса

В 1.1.2 зеркало включалось *после* двух сбоев — то есть пользователь сначала
ждал таймаут официального хоста, а иногда получал 403 и «Сеть недоступна».
В 1.2.0 порядок обращён:

* `urlCandidates(url)` возвращает `[bmclapi…, official]` **всегда**, без
  предварительных проб и без режима `unknown`; официальный URL остаётся
  вторым кандидатом, поэтому падение зеркала деградирует, а не ломает;
* `xmclDownloadOptions()` отдаёт `@xmcl` готовые `mavenHost` / `assetsHost` с
  зеркалом первым (`/maven`, `/assets`) и переписанный `assetsIndexUrl`;
  режим `official` (когда зеркало доказано мертво) меняет списки местами;
* таймаут заголовков зависит от хоста: **4 с** для Mojang
  (`OFFICIAL_CONNECT_TIMEOUT_MS`) и 8 с для зеркала; ответ, который не пришёл
  за это время, отменяется и повторяется на зеркале — то есть переключение
  укладывается в требуемые 3–5 с;
* простой тела — 15 с (`res.setTimeout`), после него попытка прерывается и
  повторяется; всего 4 попытки на файл;
* `checkNetwork()` теперь выбирает зеркало, если оно ответило, даже когда
  Mojang жив: одна предсказуемая скорость вместо лотереи 403.

Докачка не изменилась по смыслу, но проверена в 1.2.0 на локальном сервере:
`.part` + `Range: bytes=N-` + `206`, а `416` очищает `.part` и начинает файл
заново. Кнопка «Продолжить установку» возвращает ровно на тот же файл/байт.

### 14.3. Проверка

| Проверка | Результат |
|---|---|
| `npm run typecheck` (node, test, web, installer) | чисто |
| node: `vitest run --config vitest.config.ts` | **159 passed / 7 skipped** (15 файлов) |
| UI: `vitest run --config vitest.ui.config.ts` | **28 passed** |
| `electron-vite build` (лаунчер) | ✔ `out/main`, `out/preload`, `out/renderer` |
| `electron-vite build -c electron.vite.installer.config.ts` | ✔ `installer/app/main.js` (58 КБ, yauzl внутри) + `renderer/` |
| `tests/bootstrapper.test.ts` | 10 тестов: пути, реестр, экранирование апострофов в PowerShell, монотонность процентов, реальный zip-round-trip, install/uninstall с внедрёнными `fileOps` |
| `tests/installer.test.ts` | 13 тестов: payload вместо NSIS, `extraResources`, имя артефакта, ключ реестра, LOCALAPPDATA, галочка данных, frameless-окно, `--wait-pid`, палитра без эмодзи, синхронизация версий |
| `tests/download-engine.test.ts` | 18 тестов: зеркало первым без проб, пин на официальный хост при мёртвом зеркале, 4 с/8 с, монотонность, Range, редирект |
| UI: тост без `{file}` | новый тест: сообщение без имени файла уходит в `errors.network_error.generic` |

Windows-упаковка (portable exe, реестр, ярлыки) проверяется только в CI —
в песочнице нет Windows-toolchain, а `bmclapi2.bangbang93.com` недоступен.

## 15. Подпись Authenticode и SmartScreen (1.2.0+)

Вопрос из чата: «а как убрать смартскрин». Ответ короткий — только сертификатом
code signing; всё остальное либо обход для пользователя, либо сбор репутации.
Ниже — что сделано в коде, чтобы подпись включалась без переписывания пайплайна.

### 15.1. Почему окно вообще появляется

Браузер ставит на скачанный файл метку «из интернета» (Mark-of-the-Web).
SmartScreen запускает такой файл только если у хеша/издателя есть репутация —
у нового лаунчера её нет, поэтому появляется синее окно. Отдельное жёлтое окно
«Неизвестный издатель» относится к UAC и у нас не появляется: установщик работает
в профиле пользователя.

Подпись не отменяет окно мгновенно: с 2024 года Microsoft убрал автоматическую
репутацию для EV, и OV/EV набирают её одинаково. Что даёт подпись — имя издателя
вместо «Unknown publisher», накопление репутации **издателя** (а не только
конкретного файла) и доверие в корпоративных окружениях.

### 15.2. Что добавлено в репозиторий

| Файл | Роль |
|---|---|
| `scripts/sign-artifact.mjs` | провайдер-агностик подпись: `VERDANT_SIGN_CMD` с плейсхолдером `{file}`, кавычки для путей с пробелами, громкий no-op без секрета |
| `scripts/sign-artifact.d.mts` | типы для строгого `tsc` в тестах |
| `.github/workflows/release.yml` | `Sign launcher payload` (до `make-payload`), `Sign bootstrapper` (после упаковки), `Verify Authenticode signatures` |
| `.github/workflows/ci.yml` | те же шаги в job «Windows bootstrapper» + `Report signature status` |
| `docs/SMARTSCREEN.md` | разбор: два окна, что не работает, варианты сертификатов и цены, чек-лист покупки |
| `tests/signing.test.ts` | 11 тестов: подстановка `{file}`, кавычки, no-op, падение при ошибке CLI, порядок шагов, гейт на `Valid` + таймстамп |

Ключевые решения:

* **никакого `.pfx` в секретах** — с июня 2023 CA/Browser Forum требует неэкспортируемый
  ключ на токене/HSM, поэтому единственная точка интеграции — внешняя команда подписи;
* **порядок важен**: payload подписывается до `app.zip`, иначе внутри архива лежит
  неподписанный `VerdantLauncher.exe`, который потом копируется в `%LOCALAPPDATA%`
  и работает деинсталлятором; setup.exe подписывается после `electron-builder`;
* **гейт**: при заданном секрете `Status -ne 'Valid'` или отсутствие
  `TimeStamperCertificate` валит job; без секрета — предупреждение
  `::warning title=Сборка без подписи::`, потому что обычные сборки подписывать нечем;
* таймстамп обязателен: без него все выпущенные версии перестают проходить проверку
  в день истечения сертификата.

### 15.3. Проверка

* `npx vitest run tests/signing.test.ts` — 11/11;
* `node scripts/sign-artifact.mjs <file>` без переменной — `UNSIGNED …`, exit 0;
  с `VERDANT_SIGN_CMD='echo {file}'` — `signed …`, exit 0; с падающей командой — exit 1;
* YAML обоих workflow валидируется `js-yaml`, порядок шагов проверяется тестом;
* `npm run typecheck` (4 конфига) — чисто; остальные наборы не менялись.

Чего нельзя проверить в песочнице: саму подпись и поведение SmartScreen — для этого
нужен сертификат и Windows. Пайплайн к этому готов: один секрет, дальше гейт сам
не даст выпустить неподписанный или просроченный артефакт.

### 15.4. «Чтобы вообще не вылезало»: каналы без Mark-of-the-Web

Окно SmartScreen включает не отсутствие подписи, а метка «скачано из интернета».
Браузер её ставит, `Invoke-WebRequest` и winget — нет. Отсюда два канала, где окна
не бывает **вообще**, даже без сертификата:

| Канал | Как | Почему без окна |
|---|---|---|
| PowerShell | `irm …/releases/latest/download/install.ps1 \| iex` | `Invoke-WebRequest` не пишет `Zone.Identifier` |
| winget | `winget install BalaRmack.VerdantLauncher` | winget качает сам и ставит ZoneId=2 (trusted) |
| апдейтер | «Обновить» в лаунчере | файл качает наш код |

Добавлено:

* `scripts/install.ps1` (BOM + CRLF для PowerShell 5.1): запрос релиза через API,
  скачивание, `Unblock-File` если метка осталась с прошлой попытки, сверка SHA-256
  с `checksums.txt`, только потом запуск. Параметры: `-VerifyOnly`, `-Version`,
  `-InstallerArgs`, `-Keep`. Подключается к релизу как ассет `install.ps1`, поэтому
  URL `releases/latest/download/install.ps1` стабилен;
* `scripts/make-winget-manifest.mjs` — генерирует 4 манифеста (version, installer,
  ru-RU, en-US) из подписанного exe: URL, SHA-256 (верхний регистр — так принято
  в winget), `InstallerType: exe`, `Scope: user`, `InstallerSwitches.Silent:
  --silent --no-launch`, `AppsAndFeaturesEntries` под нашу запись в `HKCU`;
* `installer/main.ts` понимает `--no-launch`: апдейтер хочет вернуть лаунчер
  пользователю, а пакетный менеджер — нет;
* `checksums.txt` пишется после подписи (иначе хеш не совпал бы), прикладывается
  к релизу; `winget`-манифесты — артефакт релизного прогона;
* CI: `install.ps1` парсится настоящим парсером PowerShell
  (`[Parser]::ParseFile`), манифест валидируется `winget validate` (не блокирует
  сборку — версия winget на раннере меняется);
* `tests/no-browser-install.test.ts` — 15 тестов: BOM/CRLF, «хеш проверяется до
  запуска», наличие `Zone.Identifier`/`Unblock-File`, схема манифеста, `--no-launch`,
  порядок шагов в релизе.

Ограничение остаётся ровно одно: браузерная загрузка `.exe` — пока нет
сертификата и репутации, окно будет (раздел 15.1–15.3).

### 15.5. Манифесты winget проверяются схемой, а не «на глаз»

Первая попытка сгенерировать манифест дала зелёный job и неверный файл:
`winget validate` на раннере ругался, но шаг был `continue-on-error`, и в логах
осталась только строка «манифест не прошёл проверку схемы». Причина нашлась
офлайн: схемы манифестов выкачаны из `microsoft/winget-cli`
(`scripts/winget-schemas/`, MIT) и прогнаны через `ajv`:

* `ManifestVersion` — **строка** `1.6.0`, а не `1.6`: схема требует
  `major.minor.patch`, а YAML вдобавок читает `1.6` как число;
* `ReleaseNotesUrl` есть только у `locale`, у `defaultLocale` его нет;
* `Moniker` — только у `defaultLocale`;
* ровно один `defaultLocale` на пакет: `en-US`, `ru-RU` — обычный `locale`.

Теперь `tests/no-browser-install.test.ts` валидирует все четыре файла против
официальных JSON-схем (17 тестов), а шаг `winget validate` в CI печатает причину
в аннотацию, чтобы следующая поломка не была загадкой.

Вторая поломка нашлась той же аннотацией: `winget validate --manifest <dir>`
разбирает **все** файлы в каталоге, а рядом с YAML лежал `checksums.txt`
(«The manifest does not contain a valid root. File: checksums.txt»). Теперь
манифесты пишутся в `dist-winget/manifests/`, а контрольная сумма — уровнем выше.

### 15.6. Релиз 1.2.1

Отдельная версия, чтобы «установка без окна» стала доступна сразу, а не со
следующего релиза: `install.ps1` и `checksums.txt` теперь прикладываются к релизу,
поэтому `releases/latest/download/install.ps1` — рабочий адрес. Манифесты winget
уезжают артефактом прогона; первая публикация в `microsoft/winget-pkgs` — PR
владельца репозитория (нужен CLA), дальше `wingetcreate update`.

Проверено: `typecheck` ×4, node **189 passed / 7 skipped**, UI **28 passed**, обе
сборки; CI run `41403027553` — 3/3 job, включая `winget validate --manifest` на
Windows (единственные аннотации — deprecation Node 20 и ожидаемое «подписи нет»).

Отдельная строка про грабли, на которых этот релиз и упал. Первый прогон
(`41404774540`) умер за минуту на юнит-тестах Windows: `tests/signing.test.ts` и
`tests/no-browser-install.test.ts` не загрузились с `SyntaxError: Invalid or
unexpected token`. Причина — не код, а выкатка: на Windows-раннере
`core.autocrlf=true`, поэтому `scripts/*.mjs` получал CRLF. esbuild срезает
`#!`-строку ровно до `\n`, и в начале модуля оставался висячий `\r`. Воспроизведено
локально переводом `sign-artifact.mjs` на CRLF; лечится `.gitattributes`
(`* text=auto eol=lf`, `*.ps1 -text` — PowerShell 5.1 хочет CRLF и BOM), а тест в
`no-browser-install.test.ts` теперь проверяет LF в скриптах, чтобы это не вернулось.
После фикса (`0ac0402`) тег `v1.2.1` переехал на него; Release run `41406244052`
— все шаги зелёные, опубликованы `Verdant-Launcher-1.2.1-Setup.exe`
(273 116 458 B), `install.ps1` (6 136 B) и `checksums.txt` (99 B, sha256 экзешника
`e02b5e5e…866ff5`).
