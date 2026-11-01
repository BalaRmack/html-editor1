/*
 * Verdant Launcher — custom NSIS installer & uninstaller.
 *
 * electron-builder injects this file through `nsis.include`; it is parsed
 * *before* `installer.nsi` (and therefore before MUI2.nsh), which is what lets
 * us set the MUI theme defines and register the `custom*` hooks the template
 * looks for. Bitmaps come from `build/installer/` and are rendered by
 * `build/installer/generate.py` (164×314 sidebars, 150×57 header, 64×64 logo).
 *
 * Resulting wizard:
 *   install   — welcome (branded) → folder → install mode → progress → finish
 *   uninstall — «Удаление Verdant Launcher»: «Удалить настройки и сохранения»
 *               + «Удалить» / «Отмена» → progress → finish
 */

!include "nsDialogs.nsh"
!include "WinMessages.nsh"

/* =====================================================  theme (MUI hooks) */

; Dark wizard pages. MUI2 paints the page body, the header text and the
; welcome/finish pages with these two colours (Interface.nsh, Welcome.nsh,
; Finish.nsh), so the whole wizard follows the launcher palette.
!define MUI_BGCOLOR "0C0D0B"
!define MUI_TEXTCOLOR "ECF2E7"

; Progress page: emerald bar on the ink background.
!define MUI_INSTFILESPAGE_COLORS "0C0D0B ECF2E7"
!define MUI_INSTFILESPAGE_PROGRESSBAR colored

; Keep the "are you sure you want to abort?" prompt — the wizard is cancellable.
!define MUI_ABORTWARNING

/* Copy (Russian — the installer follows the RU-first product language).
 * MUI's own strings (buttons, directory page, errors) stay localised by
 * electron-builder. */
!define MUI_WELCOMEPAGE_TITLE "Добро пожаловать в Verdant Launcher"
!define MUI_WELCOMEPAGE_TEXT "Мастер установит лаунчер Minecraft в вашу папку пользователя.$\r$\n$\r$\nЯрлыки появятся на Рабочем столе и в меню «Пуск». Данные игры хранятся в отдельной папке %APPDATA%\Verdant и не затрагивают ваш .minecraft."

!define MUI_FINISHPAGE_TITLE "Установка завершена"
!define MUI_FINISHPAGE_TEXT "Verdant Launcher установлен.$\r$\n$\r$\nНажмите «Готово», чтобы закрыть мастер."
!define MUI_FINISHPAGE_RUN_TEXT "Запустить Verdant Launcher"

!define MUI_UNFINISHPAGE_TITLE "Verdant Launcher удалён"
!define MUI_UNFINISHPAGE_TEXT "Приложение и его ярлыки удалены с этого компьютера."

/* Uninstaller options page copy. */
!define VD_UN_TITLE "Удаление Verdant Launcher"
!define VD_UN_SUBTITLE "Приложение и его ярлыки будут удалены с этого компьютера."
!define VD_UN_CHECKBOX "Удалить настройки и сохранения"
!define VD_UN_CHECKBOX_HINT "Сборки, моды и миры в %APPDATA%\Verdant"
!define VD_UN_FOOTNOTE "Файлы Minecraft в общей папке .minecraft не затрагиваются."
!define VD_UN_BUTTON "Удалить"

/* Separate art for the uninstaller header (MUI defaults it to the installer
 * one; we override before Interface.nsh looks it up). */
!ifdef MUI_HEADERIMAGE
  !define MUI_HEADERIMAGE_UNBITMAP "${BUILD_RESOURCES_DIR}\installer\uninstallerHeader.bmp"
!endif

/* =====================================================  state */

Var vdWipeUserData     ; "1" when the user asked to delete settings & saves
Var vdUnPage
Var vdUnLogo
Var vdUnTitle
Var vdUnSubtitle
Var vdUnCheckbox
Var vdUnHint
Var vdUnFootnote
Var vdBitmap           ; scratch bitmap handle

!define VD_LR_LOADFROMFILE 0x0010
!define VD_IMAGE_BITMAP 0

/* Loads a .bmp into ${OUTVAR} (0 on failure). */
!macro VD_LOAD_BITMAP FILE OUTVAR
  Push $R9
  System::Call 'user32::LoadImageW(i 0, w "${FILE}", i ${VD_IMAGE_BITMAP}, i 0, i 0, i ${VD_LR_LOADFROMFILE}) i .R9'
  StrCpy ${OUTVAR} $R9
  Pop $R9
!macroend

/* =====================================================  installer pages */

; Welcome page: MUI's own page, themed by the defines above (sidebar art,
; dark body, Inter-rendered copy is baked into the sidebar bitmap).
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

/* =====================================================  uninstaller page */

/*
 * Replaces MUI's uninstall welcome page: one tidy page that asks the only
 * question an uninstaller needs to ask. Everything is created here (rather
 * than at file scope) because MUI's macros only exist once installer.nsi has
 * included MUI2.
 */
!macro customUnWelcomePage
  UninstPage custom un.VerdantOptionsCreate un.VerdantOptionsLeave

  Function un.VerdantOptionsCreate
    InitPluginsDir
    File "/oname=$PLUGINSDIR\logo.bmp" "${BUILD_RESOURCES_DIR}\installer\logo.bmp"

    nsDialogs::Create 1018
    Pop $vdUnPage
    ${If} $vdUnPage == error
      Abort
    ${EndIf}

    ; Reuse the wizard's own buttons, only the labels change.
    GetDlgItem $R0 $HWNDPARENT 1
    ${If} $R0 != 0
      SendMessage $R0 ${WM_SETTEXT} 0 "STR:${VD_UN_BUTTON}"
    ${EndIf}

    SetCtlColors $vdUnPage "" "0C0D0B"

    ; brand mark
    !insertmacro VD_LOAD_BITMAP "$PLUGINSDIR\logo.bmp" $vdBitmap
    ${NSD_CreateBitmap} 0 0 56 56 ""
    Pop $vdUnLogo
    ${If} $vdBitmap != 0
      SendMessage $vdUnLogo ${STM_SETIMAGE} ${VD_IMAGE_BITMAP} $vdBitmap
    ${EndIf}

    ${NSD_CreateLabel} 68 4 100% 20 "${VD_UN_TITLE}"
    Pop $vdUnTitle
    SetCtlColors $vdUnTitle "ECF2E7" "0C0D0B"
    CreateFont $R1 "Segoe UI Semibold" "12" "600"
    SendMessage $vdUnTitle ${WM_SETFONT} $R1 0

    ${NSD_CreateLabel} 68 26 100% 34 "${VD_UN_SUBTITLE}"
    Pop $vdUnSubtitle
    SetCtlColors $vdUnSubtitle "8D9C94" "0C0D0B"

    ${NSD_CreateCheckbox} 0 86 100% 22 "${VD_UN_CHECKBOX}"
    Pop $vdUnCheckbox
    SetCtlColors $vdUnCheckbox "ECF2E7" "0C0D0B"
    ${NSD_Check} $vdUnCheckbox

    ${NSD_CreateLabel} 22 106 100% 22 "${VD_UN_CHECKBOX_HINT}"
    Pop $vdUnHint
    SetCtlColors $vdUnHint "8D9C94" "0C0D0B"

    ${NSD_CreateLabel} 0 138 100% 22 "${VD_UN_FOOTNOTE}"
    Pop $vdUnFootnote
    SetCtlColors $vdUnFootnote "6B7A72" "0C0D0B"

    nsDialogs::Show
  FunctionEnd

  Function un.VerdantOptionsLeave
    ${NSD_GetState} $vdUnCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $vdWipeUserData "1"
    ${Else}
      StrCpy $vdWipeUserData "0"
    ${EndIf}
  FunctionEnd
!macroend

/* =====================================================  uninstall work */

/*
 * Runs at the top of electron-builder's uninstall section, i.e. while the
 * progress page is visible. `$APPDATA` is per-user on purpose: Electron always
 * keeps userData under %APPDATA%, even for per-machine installs.
 */
!macro customUnInstall
  ${If} $vdWipeUserData == "1"
    SetShellVarContext current
    RMDir /r "$APPDATA\Verdant"
    RMDir /r "$LOCALAPPDATA\Verdant"
  ${EndIf}
!macroend

/* =====================================================  init hooks */

!macro customHeader
!macroend

/* Installer side: initialise the uninstaller flag so the variable is always
 * set (NSIS aborts on "variable never set" warnings when built with -WX). */
!macro customInit
  StrCpy $vdWipeUserData "0"
!macroend

/* Uninstaller side: same, before any page runs (also covers silent /S runs). */
!macro customUnInit
  StrCpy $vdWipeUserData "0"
!macroend
