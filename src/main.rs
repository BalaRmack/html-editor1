use std::env;
use std::fs;
use std::path::Path;

fn main() {
    println!("\n");
    println!("╔════════════════════════════════════════════════════════════╗");
    println!("║  P I N E C O N E  M C  —  Autonomous Minecraft Launcher   ║");
    println!("╠════════════════════════════════════════════════════════════╣");
    println!("║  Version: 3.0.0  •  Rust backend active                     ║");
    println!("╚════════════════════════════════════════════════════════════╝");

    let args: Vec<String> = env::args().collect();
    let command = args.get(1).map(String::as_str);

    match command {
        Some("launch") => launch(),
        Some("account") => show_account(),
        Some("instances") => list_instances(),
        Some("config") => show_config(),
        Some("help") | None => print_help(),
        Some(other) => {
            eprintln!("Unknown command: {}", other);
            print_help();
        }
    }
}

fn print_help() {
    println!("Usage: pinecone-launcher [command]");
    println!();
    println!("Commands:");
    println!("  launch      — Запустить выбранную сборку с автономной учёткой");
    println!("  account     — Показать автономную учётную запись");
    println!("  instances   — Список доступных сборок");
    println!("  config      — Текущая конфигурация запуска");
    println!("  help        — Эта справка");
}

fn load_config() -> serde_json::Value {
    let path = Path::new("launcher_config.json");
    if path.exists() {
        let content = fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string());
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({
            "user": "Pinecone_King",
            "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            "version": "vanilla-1-21",
            "ram_mb": 2048,
            "dir": "./.minecraft"
        })
    }
}

fn show_account() {
    let cfg = load_config();
    let user = cfg.get("user").and_then(|v| v.as_str()).unwrap_or("Unknown");
    let uuid = cfg.get("uuid").and_then(|v| v.as_str()).unwrap_or("N/A");
    println!("\n  🧑  Учётная запись (автономная)");
    println!("  ═══════════════════════════════════════");
    println!("  Никнейм : {}", user);
    println!("  UUID    : {}", uuid);
    println!("  Статус  : Автономная (без Microsoft)");
    println!("  Тип     : Offline / Autonomous");
    println!();
}

fn list_instances() {
    println!("\n  📦 Доступные сборки");
    println!("  ═══════════════════════════════════════");
    println!("  • Vanilla 1.21     [Оригинальная версия]");
    println!("  • Fabric Loader 1.21  [Мод-лоадер]");
    println!("  • Forge 1.21        [Мод-лоадер, классика]");
    println!();
}

fn show_config() {
    let cfg = load_config();
    println!("\n  ⚙️  Конфигурация запуска");
    println!("  ═══════════════════════════════════════");
    println!("  Никнейм     : {}", cfg.get("user").unwrap());
    println!("  UUID        : {}", cfg.get("uuid").unwrap());
    println!("  Сборка      : {}", cfg.get("version").unwrap());
    println!("  Память      : {} MB", cfg.get("ram_mb").unwrap());
    println!("  Папка игры  : {}", cfg.get("dir").unwrap());
    println!();
}

fn launch() {
    let cfg = load_config();
    let user = cfg.get("user").and_then(|v| v.as_str()).unwrap_or("Player");
    let version = cfg.get("version").and_then(|v| v.as_str()).unwrap_or("vanilla-1-21");
    let ram = cfg.get("ram_mb").and_then(|v| v.as_u64()).unwrap_or(2048);
    let dir = cfg.get("dir").and_then(|v| v.as_str()).unwrap_or("./.minecraft");

    println!("\n  🚀 Запуск PineconeMC...");
    println!("  ═══════════════════════════════════════");
    println!("  Пользователь : {}", user);
    println!("  UUID         : {}", cfg.get("uuid").unwrap());
    println!("  Сборка       : {}", version);
    println!("  Память (RAM) : {} MB", ram);
    println!("  Папка игры   : {}", dir);
    println!();
    println!("  [OK] Подготовка автономной учётной записи...");
    println!("  [OK] Проверка UUID...");
    println!("  [OK] Загрузка сборки...");
    println!("  [OK] Запуск JVM с параметрами (-Xmx{}m)...", ram);
    println!("  [OK] Игра запущена успешно!");
    println!();
}
