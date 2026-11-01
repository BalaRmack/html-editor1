@echo off
REM PineconeMC 1.1.1 — Installer
REM Autonomous Minecraft Launcher with Beautiful Interface

echo ╔════════════════════════════════════════════════════════════╗
echo ║  P I N E C O N E  M C  1.1.1  —  INSTALLER                  ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo [OK] Копирование файлов...
mkdir "%PROGRAMFILES%\PineconeMC" 2>nul
xcopy /E /I /Y "*.*" "%PROGRAMFILES%\PineconeMC\" >nul 2>&1

echo [OK] Создание ярлыка на рабочий стол...
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\create_shortcut.vbs"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\PineconeMC.lnk" >> "%TEMP%\create_shortcut.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\create_shortcut.vbs"
echo oLink.TargetPath = "%PROGRAMFILES%\PineconeMC\PineconeMC_Launcher.exe" >> "%TEMP%\create_shortcut.vbs"
echo oLink.Arguments = "launch" >> "%TEMP%\create_shortcut.vbs"
echo oLink.WorkingDirectory = "%PROGRAMFILES%\PineconeMC" >> "%TEMP%\create_shortcut.vbs"
echo oLink.Save >> "%TEMP%\create_shortcut.vbs"
cscript //nologo "%TEMP%\create_shortcut.vbs" >nul 2>&1
del "%TEMP%\create_shortcut.vbs" >nul 2>&1

echo [OK] Установка завершена!
echo [INFO] Запуск: PineconeMC_Launcher.exe launch
pause
