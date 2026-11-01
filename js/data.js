/* ================= SkyLauncher — mock data =================
   This mirrors PineconeMC functionality: versions, mods (Modrinth/CurseForge style),
   files, accounts, journal. In a full build these would come from real APIs.
*/
window.SK = window.SK || {};

SK.MC_VERSIONS = [
  { id: "26.3", type: "release", released: "15.09.2026", installed: true, lastPlayed: "15.09.2026 16:02" },
  { id: "26.2", type: "release", released: "16.05.2026", installed: true, lastPlayed: "09.04.2026" },
  { id: "26.1.2", type: "release", released: "09.04.2026", installed: false },
  { id: "26.1.1", type: "release", released: "01.04.2026", installed: false },
  { id: "26.1", type: "release", released: "24.03.2026", installed: false },
  { id: "1.21.11", type: "release", released: "09.12.2025", installed: false },
  { id: "1.21.10", type: "release", released: "07.10.2025", installed: false },
  { id: "1.21.9", type: "release", released: "30.09.2025", installed: false },
  { id: "1.21.8", type: "release", released: "17.07.2025", installed: false },
  { id: "1.21.7", type: "release", released: "30.06.2025", installed: false },
  { id: "1.21.6", type: "release", released: "17.06.2025", installed: false },
  { id: "1.21.5", type: "release", released: "25.03.2025", installed: false },
  { id: "1.21.4", type: "release", released: "03.12.2024", installed: false },
  { id: "1.21.3", type: "release", released: "23.10.2024", installed: false },
  { id: "1.20.1", type: "release", released: "07.12.2023", installed: false },
  { id: "1.19.4", type: "release", released: "11.07.2023", installed: false },
  { id: "1.18.2", type: "release", released: "27.04.2022", installed: false },
  { id: "1.17.1", type: "release", released: "06.07.2021", installed: false },
  { id: "1.16.5", type: "release", released: "15.01.2021", installed: false },
];

SK.INSTANCES = [
  {
    id: "inst-1", name: "Backrooms - Found Footage", version: "1.20",
    modLoader: "Found Footage 1.2.0", icon: "🟩", lastPlayed: "26.10.2023 23:03",
    playtime: "41 мин 23с", total: "1ч 23мин", status: "Имеются обновления",
  },
  {
    id: "inst-2", name: "Adventures in Time — Dalek Wasteland", version: "1.20.1",
    modLoader: "Fabric", icon: "🕹", lastPlayed: "12.11.2025 14:20",
    playtime: "5ч 12мин", total: "22ч 41мин", status: "Готов",
  },
  {
    id: "inst-3", name: "Pokémon Cobblemon", version: "1.20.1",
    modLoader: "Cobblemon 1.7.3", icon: "🧬", lastPlayed: "03.09.2025 19:10",
    playtime: "18ч 30мин", total: "64ч 11мин", status: "Обновление мода",
  },
  {
    id: "inst-4", name: "Vanilla Survival", version: "1.21.4",
    modLoader: "Ваниль", icon: "⬜", lastPlayed: "02.06.2026 20:15",
    playtime: "3ч 05мин", total: "11ч 02мин", status: "Готов",
  },
];

SK.MODS_MODRINTH = [
  { id: "m1", name: "Fabric API", authors: "modmuss50, blah...", downloads: "245 млн", summary: "Lightweight and modular API for Fabric mods.", loader: "Fabric", versions: ["1.21.4", "1.20.1", "1.19.4"], icon: "🧩", featured: true },
  { id: "m2", name: "Sodium", authors: "jellysquid3", downloads: "180 млн", summary: "A high-performance render mod.", loader: "Fabric", versions: ["1.21.4", "1.20.1"], icon: "💧", featured: true },
  { id: "m3", name: "Iris Shaders", authors: "Iris Team", downloads: "67 млн", summary: "A modern shader pack loader for Fabric.", loader: "Fabric", versions: ["1.21.4", "1.20.1"], icon: "🌈" },
  { id: "m4", name: "Entity Culling", authors: "tr7zw", downloads: "22 млн", summary: "Using async path-tracing...", loader: "Fabric/Forge", versions: ["1.21.4", "1.20.1"], icon: "👁" },
  { id: "m5", name: "Cloth Config API", authors: "aussie...", downloads: "150 млн", summary: "A mod configuration screen API.", loader: "Fabric/Forge", versions: ["1.21.4", "1.20.1"], icon: "⚙" },
];

SK.MODS_CURSEFORGE = [
  { id: "c1", name: "Adventures in Time — Dalek Wasteland", authors: "OldLostToy", downloads: "842 тыс", summary: "Welcome to the Dalek Wastelands. Structures & TARDIS.", loader: "Fabric", versions: ["1.20.1"], icon: "👽" },
  { id: "c2", name: "Architecture", authors: "TheManWithNoName", downloads: "3.2 млн", summary: "Immersive and optimized attack on titan modpack", loader: "Forge", versions: ["1.20.1"], icon: "🏛" },
  { id: "c3", name: "Better Third Person", authors: "TTC", downloads: "4.1 млн", summary: "Camera tweaks for third person.", loader: "Forge/Fabric", versions: ["1.21.4", "1.20.1"], icon: "🎥" },
  { id: "c4", name: "Biome Swap Point", authors: "Serilum", downloads: "670 тыс", summary: "Change biome at a point.", loader: "Fabric", versions: ["1.20.1"], icon: "🌍" },
];

SK.ACCOUNTS_DEFAULTS = [
  { id: "acc-1", name: "Iekna", type: "Автономная", email: "", avatar: "👤", skin: "default", active: true },
  { id: "acc-2", name: "Steve_offline", type: "Автономная", email: "", avatar: "🧍", skin: "steve", active: false },
];

SK.FILES = [
  { name: "Корневая папка лаунчера", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Экземпляры", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Основная папка модов", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Скины", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Java", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Набор загрузок", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Темы для виджетов", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Наборы котиков", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Значки примеров", type: "folder", size: "—", date: "26.11.2025" },
  { name: "Журналы", type: "folder", size: "—", date: "26.11.2025" },
];

SK.JOURNAL_LINES = [
  { t: "[23:03:45] [main/INFO]: Запуск Backrooms - Found Footage 1.2.0", cls: "info" },
  { t: "[23:03:46] [main/INFO]: Minecraft 1.20, последняя раз played 26.10.2023 23:03", cls: "" },
  { t: "[23:03:47] [mod loading/INFO]: Loading mod Found Footage 1.2.0", cls: "" },
  { t: "[23:03:48] [Render thread/INFO]: LWJGL 3.3.1 initialized", cls: "" },
  { t: "[23:03:49] [sound/INFO]: Sound system started", cls: "" },
  { t: "[23:03:50] [Render thread/WARN]: Missing texture: assets/minecraft/textures/missing.png", cls: "warn" },
  { t: "[23:03:51] [main/ERROR]: Crash report saved to crash-reports/crash-2023-10-26_23.03.51-client.txt", cls: "stack" },
  { t: "[23:03:52] [main/INFO]: Создан автономный профиль игрока Iekna", cls: "info" },
  { t: "[23:03:53] [WorldClient/INFO]: Загрузка мира Backrooms...", cls: "" },
  { t: "[23:03:55] [Render thread/INFO]: world loaded in 1240 ms", cls: "info" },
];
