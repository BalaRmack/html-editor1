<#
.SYNOPSIS
    Устанавливает Verdant Launcher напрямую через PowerShell — без браузера.

.DESCRIPTION
    Окно «Windows защитила ваш компьютер» (SmartScreen) показывает не сама
    программа, а метка «файл скачан из интернета» (Mark of the Web,
    Zone.Identifier). Браузеры её ставят, Invoke-WebRequest — нет. Поэтому
    установка этим скриптом проходит без предупреждения, даже пока сборка не
    подписана сертификатом.

    Файл скачивается из GitHub Releases, сверяется с SHA-256 из checksums.txt
    того же релиза и только потом запускается.

.EXAMPLE
    irm https://github.com/BalaRmack/html-editor1/releases/latest/download/install.ps1 | iex

.EXAMPLE
    # тихая установка без запуска лаунчера
    .\install.ps1 -InstallerArgs '--silent','--no-launch'

.EXAMPLE
    # только скачать и проверить хеш, ничего не устанавливать
    .\install.ps1 -VerifyOnly
#>
[CmdletBinding()]
param(
    [string]   $Version = 'latest',
    # По умолчанию — обычное окно установщика. Для тихой установки:
    #   -InstallerArgs '--silent','--no-launch'
    [string[]] $InstallerArgs = @(),
    [switch]   $VerifyOnly,
    [switch]   $Keep
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'BalaRmack/html-editor1'
$headers = @{
    'User-Agent' = 'VerdantLauncher-installer'
    'Accept'     = 'application/vnd.github+json'
}

function Write-Step([string] $text) { Write-Host "  $text" -ForegroundColor DarkGray }
function Fail([string] $text) { throw "Verdant: $text" }

Write-Host ''
Write-Host '  Verdant Launcher' -ForegroundColor Green
Write-Host '  установка без окна SmartScreen' -ForegroundColor DarkGray
Write-Host ''

# 1. Какой релиз ставим -------------------------------------------------------
if ($Version -eq 'latest') {
    $api = "https://api.github.com/repos/$repo/releases/latest"
} else {
    $api = "https://api.github.com/repos/$repo/releases/tags/v$($Version.TrimStart('v'))"
}

try {
    $release = Invoke-RestMethod -Uri $api -Headers $headers
} catch {
    Fail "не удалось получить информацию о релизе ($($_.Exception.Message)). Если GitHub ограничил частоту запросов, повторите позже или укажите версию: -Version 1.2.0"
}

$setup = $release.assets | Where-Object { $_.name -like 'Verdant-Launcher-*-Setup.exe' } | Select-Object -First 1
if (-not $setup) { Fail "в релизе $($release.tag_name) нет файла Setup.exe" }
$checksums = $release.assets | Where-Object { $_.name -eq 'checksums.txt' } | Select-Object -First 1

Write-Step "релиз: $($release.tag_name)"
Write-Step "размер: $([math]::Round($setup.size / 1MB, 1)) МБ"

# 2. Скачать --------------------------------------------------------------
$target = Join-Path ([System.IO.Path]::GetTempPath()) $setup.name
Write-Step "скачивание: $($setup.name)"
Invoke-WebRequest -Uri $setup.browser_download_url -OutFile $target -UseBasicParsing

# Страховка: если в temp лежал файл, скачанный браузером, у него могла
# остаться метка «из интернета». Снимаем — именно она включает SmartScreen.
$zones = Get-Item -LiteralPath $target -Stream Zone.Identifier -ErrorAction SilentlyContinue
if ($zones) {
    Unblock-File -LiteralPath $target
    Write-Step 'снята метка «скачано из интернета»'
}

# 3. Проверить SHA-256 ----------------------------------------------------
if ($checksums) {
    $text = (Invoke-WebRequest -Uri $checksums.browser_download_url -UseBasicParsing).Content
    $expected = $null
    foreach ($line in ($text -split "`r?`n")) {
        if ($line -match ([regex]::Escape($setup.name) + '$')) {
            $expected = ($line -split '\s+')[0].Trim().ToLowerInvariant()
            break
        }
    }
    if (-not $expected) { Fail "в checksums.txt нет строки для $($setup.name)" }
    $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue
        Fail "SHA-256 не совпал: ожидался $expected, получен $actual. Файл удалён, установка отменена."
    }
    Write-Step "SHA-256 совпал: $actual"
} else {
    Write-Warning 'в релизе нет checksums.txt — файл не проверен по хешу'
}

if ($VerifyOnly) {
    Write-Host ''
    Write-Host "  Готово к установке: $target" -ForegroundColor Green
    Write-Host '  Запуск пропущен (параметр -VerifyOnly).' -ForegroundColor DarkGray
    return
}

# 4. Установить -----------------------------------------------------------
Write-Step 'запуск установщика'
$startArgs = @{ FilePath = $target; PassThru = $true }
if ($InstallerArgs.Count -gt 0) { $startArgs['ArgumentList'] = $InstallerArgs }
$process = Start-Process @startArgs
$process.WaitForExit()

if (-not $Keep) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
if ($process.ExitCode -ne 0) { Fail "установщик завершился с кодом $($process.ExitCode)" }

Write-Host ''
Write-Host '  Verdant Launcher установлен' -ForegroundColor Green
Write-Host '  ярлык «Verdant Launcher» — на Рабочем столе и в меню «Пуск»' -ForegroundColor DarkGray
Write-Host ''
