@echo off
REM PineconeMC 1.1.1 — Uninstaller

echo ╔════════════════════════════════════════════════════════════╗
echo ║  P I N E C O N E  M C  1.1.1  —  UNINSTALLER              ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo [OK] Удаление ярлыка...
del "%USERPROFILE%\Desktop\PineconeMC.lnk" 2>nul

echo [OK] Удаление конфигурации...
del "%PROGRAMFILES%\PineconeMC\launcher_config.json" 2>nul

echo [OK] Удаление файлов...
rmdir /S /Q "%PROGRAMFILES%\PineconeMC" 2>nul

echo [OK] Удаление завершено!
pause
