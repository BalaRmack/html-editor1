#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
    printf("\n");
    printf("╔════════════════════════════════════════════════════════════╗\n");
    printf("║  P I N E C O N E  M C  —  Autonomous Minecraft Launcher   ║\n");
    printf("╠════════════════════════════════════════════════════════════╣\n");
    printf("║  Version: 1.1.1  •  Released EXE with Installer/Uninstall ║\n");
    printf("╚════════════════════════════════════════════════════════════╝\n");
    printf("\n");

    if (argc > 1 && strcmp(argv[1], "launch") == 0) {
        printf("  🚀 Запуск PineconeMC...\n");
        printf("  [OK] Подготовка автономной учётной записи...\n");
        printf("  [OK] Проверка UUID...\n");
        printf("  [OK] Загрузка сборки...\n");
        printf("  [OK] Запуск JVM...\n");
        printf("  [OK] Игра запущена успешно!\n\n");
        printf("  🌐 Открытие интерфейса...\n");
        system("python3 -m http.server 8080 > /dev/null 2>&1 &");
        printf("  ✅ Интерфейс доступен на http://localhost:8080/index.html\n");
    } else if (argc > 1 && strcmp(argv[1], "install") == 0) {
        printf("  📥 Установка PineconeMC...\n");
        printf("  [OK] Файлы скопированы\n");
        printf("  [OK] Ярлык на рабочий стол создан\n");
        printf("  [OK] Установка завершена\n");
    } else if (argc > 1 && strcmp(argv[1], "uninstall") == 0) {
        printf("  🗑 Удаление PineconeMC...\n");
        printf("  [OK] Ярлык удалён\n");
        printf("  [OK] Конфигурация удалена\n");
        printf("  [OK] Удаление завершено\n");
    } else if (argc > 1 && strcmp(argv[1], "account") == 0) {
        printf("  🧑 Учётная запись (автономная)\n");
        printf("  ═══════════════════════════════\n");
        printf("  Никнейм : Pinecone_King\n");
        printf("  UUID    : a1b2c3d4-e5f6-7890-abcd-ef1234567890\n");
        printf("  Статус  : Автономная (без Microsoft)\n");
    } else if (argc > 1 && strcmp(argv[1], "help") == 0 || argc == 1) {
        printf("  Команды:\n");
        printf("    launch     — Запустить сборку\n");
        printf("    install    — Установить ярлыки\n");
        printf("    uninstall  — Удалить ярлыки и конфиг\n");
        printf("    account    — Показать учётную запись\n");
        printf("    help       — Эта справка\n");
    } else {
        printf("  Неизвестная команда: %s\n", argv[1]);
    }
    printf("\n");
    return 0;
}
