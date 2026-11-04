# Verdant Launcher — архитектура и стек

> Премиальный лаунчер Minecraft. Electron + React 18 + TypeScript + Vite.
> Документ — план на утверждение (перед написанием кода).

---

## 1. Архитектура проекта

```
html-editor1/
├─ .github/workflows/release.yml        # CI: tag v* -> bootstrapper .exe -> GitHub Release
├─ build/                               # ресурсы electron-builder
│  ├─ icon.ico                          # иконка приложения / установщика
│  └─ icon.png                          # 512x512
├─ docs/PLAN.md
├─ electron.vite.config.ts              # 3 сборки: main / preload / renderer
├─ electron-builder.yml                 # payload лаунчера (--dir), publish=github
├─ electron-builder.installer.yml       # bootstrapper: portable .exe с app.zip внутри
├─ installer/                           # своё приложение-установщик (main/core/preload/renderer)
├─ package.json / package-lock.json
├─ tsconfig.json / tsconfig.node.json / tsconfig.web.json
└─ src/
   ├─ shared/                           # общий код main <-> renderer (без node API)
   │  ├─ ipc.ts                         # имена каналов + типы payload
   │  └─ types.ts                        # Instance, Profile, Settings, ModHit, LogLine...
   │
   ├─ preload/index.ts                  # contextBridge: window.launcher (единственный мост)
   │
   ├─ main/
   │  ├─ index.ts                       # bootstrap, single-instance lock, окно, tray-less
   │  ├─ window.ts                      # frameless окно, titleBarStyle hidden, 1280x800
   │  ├─ ipc/                           # тонкий слой: валидация payload -> service
   │  │  ├─ index.ts                    # регистрация всех хендлеров
   │  │  ├─ profile.ipc.ts  instances.ipc.ts  launch.ipc.ts
   │  │  ├─ java.ipc.ts     mods.ipc.ts      settings.ipc.ts  system.ipc.ts
   │  └─ services/
   │     ├─ paths.service.ts            # %APPDATA%/Verdant: shared/, instances/, cache/
   │     ├─ store.service.ts            # атомарная JSON-персистенция (tmp+rename)
   │     ├─ profile.service.ts          # offline-профиль, UUID = MD5("OfflinePlayer:ник")
   │     ├─ instances.service.ts        # CRUD, clone, rename, иконки, per-instance JSON
   │     ├─ installer.service.ts        # Vanilla/Fabric/Quilt/Forge/NeoForge
   │     ├─ launch.service.ts           # classpath, нативы, RAM, JVM args, процесс игры
   │     ├─ java.service.ts             # поиск JDK/JRE: реестр Windows + стандартные пути
   │     ├─ mods.service.ts             # Modrinth API, зависимости, установка/удаление
   │     ├─ skins.service.ts            # локальные скины: валидация 64x64, предпросмотр
   │     ├─ log.service.ts              # кольцевой буфер + события в renderer
   │     └─ progress.service.ts         # единый прогресс задач (скачивание/установка)
   │
   └─ renderer/
      ├─ index.html
      └─ src/
         ├─ main.tsx  App.tsx
         ├─ lib/bridge.ts               # типизированный window.launcher + mock для browser-preview
         ├─ store/                      # zustand: profile, instances, settings, ui/toasts, tasks
         ├─ styles/globals.scss + animations.scss + tokens
         ├─ components/ui/              # GlassPanel, Button, Slider, Switch, Modal, Toast, Skeleton, Spinner, Tooltip, Select, IconPicker
         ├─ components/layout/          # TitleBar (drag), Sidebar, TopBar, PageShell, AnimatedBackground
         └─ features/
            ├─ play/                    # большая кнопка ИГРАТЬ, герой-карточка инстанса, статусы
            ├─ instances/               # сетка, визард создания, карточка сборки, моды/логи
            ├─ mods/                    # браузер Modrinth: поиск, фильтры, карточка мода
            ├─ skins/                   # локальный скин + 2D-рендер модели
            ├─ settings/                # общие, Java, ОЗУ, JVM-аргументы (advanced), о лаунчере
            └─ console/                 # консоль с подсветкой, автоскроллом, копированием
```

### Поток данных

```
React (zustand)  --invoke-->  preload (contextBridge, whitelisted API)
                 <--on-------  ipcMain  --> services (fs / http / spawn java)
```

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (нужен preload c require electron),
  `webSecurity: true`, блокировка `window.open`, запрет навигации наружу (внешние ссылки — `shell.openExternal`).
- Renderer никогда не импортирует `fs`/`path`/`child_process`. Только `window.launcher`.
- Все каналы — из `src/shared/ipc.ts`; preload отдаёт фиксированный набор методов (не generic `invoke`).

### Где лежат данные

```
%APPDATA%\Verdant\
├─ config.json                     # профиль, настройки, список инстансов, выбранный инстанс
├─ shared\                         # общий кеш игры (одна копия на все сборки)
│  ├─ assets\ libraries\ versions\
├─ java\                           # авто-скачанные JRE от Mojang (по необходимости)
├─ instances\<id>\
│  ├─ instance.json                # версия, загрузчик, RAM, JVM args, иконка, заметки
│  ├─ icon.png
│  └─ minecraft\                   # gameDir: mods\, saves\, config\, logs\, options.txt
└─ cache\                          # иконки/ответы Modrinth
```

Изоляция: у каждой сборки свой `gameDir`, общий только `assets/libraries/versions`
(так работает Prism/Modrinth App) — экономия гигабайт и корректные моды.

---

## 2. dependencies

| Пакет | Версия | Зачем |
|---|---|---|
| `@xmcl/core` | ^2.16.3 | парсинг/резолв версий, аргументы запуска, classpath, извлечение нативов, pre-checks, watcher процесса |
| `@xmcl/installer` | 6.0.0 (pin) | установка Vanilla / Fabric / Quilt / Forge / NeoForge (включая post-processors Forge) |
| `react`, `react-dom` | 18.3.1 | UI (строго React 18) |
| `zustand` | ^5.0.16 | стейт |
| `framer-motion` | ^14.9.0 | анимации, layout-переходы, skeletons |
| `lucide-react` | ^1.66.0 | иконки (деревья шейкаются) |
| `@fontsource-variable/inter`, `@fontsource/press-start-2p` | ^5.3.0 | шрифты офлайн (без CDN) |
| `clsx` | ^2.1.1 | `cn()` хелпер |

## 3. devDependencies

| Пакет | Версия | Зачем |
|---|---|---|
| `electron` | ^45.2.1 | runtime |
| `electron-vite` | ^5.0.0 | сборка main/preload/renderer (esbuild + Vite 7) |
| `vite` | ^7.3.7 | бандлер renderer |
| `@vitejs/plugin-react` | ^5.1.0 | React (Babel/SWC HMR) |
| `electron-builder` | ^26.18.0 | portable `.exe` установщика, GitHub Release |
| `typescript` | ^5.9.3 | типы |
| `tailwindcss` + `@tailwindcss/vite` | ^4.3.3 | utility-CSS |
| `sass` | ^1.107.1 | SCSS для glass-эффектов/анимаций |
| `@types/node`, `@types/react`, `@types/react-dom` | — | типы |

## 4. Ключевые технические решения

**Ядро: `@xmcl/core` + `@xmcl/installer` вместо `minecraft-launcher-core`.**
- `minecraft-launcher-core` 3.18.2 не обновлялся с дек. 2024, зависит от deprecated `request`,
  не умеет NeoForge/Quilt, не содержит post-processors Forge (новые версии не запустятся),
  и не решает проблему нативов/classpath так же чисто.
- `@xmcl/core` — референсная реализация (её использует XMCL), обновлена 31.10.2026:
  `Version.parse()` + резолв наследования версий, `generateArguments()`, `launch()`,
  `LaunchPrecheck.checkNatives/checkLibraries/checkVersion`, watcher процесса с crash-report.
- `@xmcl/installer` 6.3.7 **сломан в npm** (зависимость `@xmcl/unzip` объявлена как `workspace:^*`,
  `npm i` падает с EUNSUPPORTEDPROTOCOL) → пиню проверенную `6.0.0`, которая ставится и работает.
- Forge-установщик качаем по явному HTTPS-URL `maven.minecraftforge.net` (в либе дефолт — устаревший http).

**Дополнительно реализую сам (не отдаю библиотеке):**
- установку JRE от Mojang (`installJreFromMojang`), если Java не найдена, + поиск JDK через реестр Windows;
- проверку целостности: `diagnoseInstall` + докачка при запуске;
- Modrinth-клиент с разрешением зависимостей (Fabric API и т.п.), выбором версии под loader+MC;
- прогресс задач (единый Task/Progress IPC), логи с подсветкой.

## 5. Дизайн-система

- Фон: `#0B0D0C` -> `#14171 6` (глубокий графит), стеклянные панели `rgba(255,255,255,.04)` + `backdrop-blur(28px)`,
  тонкие бордеры `rgba(255,255,255,.08)`, внутренние highlight-линии.
- Акценты: изумруд `#2FE28C` / `#10B981`, золото `#F5C249`. Градиентный текст и glow только на CTA.
- Текст: Inter Variable; пиксельный `Press Start 2P` — только логотип и заголовки секций.
- Компоновка: сайдбар 88px (иконки + tooltips), топбар 64px (профиль, настройки), окно без рамки с кастомным drag-титлбаром.
- Анимации: Framer Motion (`layout`, `AnimatePresence`, stagger), скелетоны вместо спиннеров на списках,
  «дышащий» фон (canvas-particles, 60fps, отключается в настройках), toasts справа сверху.
- Состояния: idle / preparing / downloading / running / crashed — везде разные визуальные слои, без «пустых» экранов.

## 6. Порядок работ

1. Скелет проекта, конфиги, дизайн-система, мок-данные.
2. Main-процесс: paths/store/profile/instances/java.
3. UI: Play, Instances (+визард), Settings, Console.
4. Ядро игры: installer + launch + логи + прогресс.
5. Modrinth, скины, полировка.
6. Сборка, тесты сервисов (без GUI), CI-workflow, тег `v1.0.0`, проверка артефакта в релизе.

## 7. Проверка (в этой среде)

- `npm run typecheck` (strict TS во всех трёх таргетах).
- `npm run build` (electron-vite build).
- Node-скрипты на сервисы: UUID, CRUD инстансов, поиск Java, Modrinth API,
  реальная установка vanilla 1.21.x в temp-каталог + `Version.parse` + `generateArguments` (classpath/нативы проверяются без запуска JVM).
- Browser-preview renderer (`npm run preview:ui`) — живой просмотр интерфейса без Electron.
- CI: `.exe` в GitHub Release по тегу `v1.0.0`.

---

## 8. Итог (по факту реализации)

- Название: **Verdant Launcher** (`app.verdant.launcher`), данные — `%APPDATA%\Verdant\data` (изолированно, путь меняется в настройках).
- Языки: RU + EN, переключатель в настройках.
- Ядро: `@xmcl/core` **2.15.1** + `@xmcl/installer` **6.0.0** — обе версии запинены, потому что
  2.16.x / 6.3.x публикуют `workspace:^*` в зависимостях `@xmcl/unzip` и ломают `npm i`.
- Renderer-библиотеки (React, Framer Motion, Zustand, шрифты…) перенесены в `devDependencies`:
  они бандлятся Vite, поэтому не попадают в asar — установщик легче.
- Дополнительно к плану: импорт модпаков `.mrpack`/CurseForge, поиск Java в реестре расширен вендорами,
  трей при запущенной игре, CI-джоб с живыми запросами к Mojang/Fabric/Forge/NeoForge/Modrinth.
