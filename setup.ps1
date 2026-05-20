#Requires -Version 5.1
<#
.SYNOPSIS
    PSO Tool – Bibliotheken herunterladen

.DESCRIPTION
    Lädt alle notwendigen JavaScript-Bibliotheken für das PSO Tool herunter
    und speichert sie im Ordner "libs/". Nach dem Herunterladen funktioniert
    das Tool vollständig offline – keine Internetverbindung mehr nötig.

    Heruntergeladen werden:
      - PDF.js 3.11.174   (PDF rendern im Browser)
      - OpenCV.js 4.8.0   (Bildverarbeitung, WASM-Bundle ~8 MB)
      - Bootstrap 5.3.2   (CSS/JS Framework)

.PARAMETER Force
    Wenn angegeben, werden bereits vorhandene Dateien überschrieben.

.EXAMPLE
    .\setup.ps1
    .\setup.ps1 -Force

.NOTES
    Für den normalen Betrieb des Tools wird KEINE Internetverbindung benötigt.
    Dieses Skript muss nur einmalig ausgeführt werden.
#>
[CmdletBinding()]
param(
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================
# Konfiguration
# ============================================================

$LibsDir = Join-Path $PSScriptRoot 'libs'

$Libraries = @(
    # PDF.js — Core library
    @{
        Url         = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
        File        = 'pdf.min.js'
        Description = 'PDF.js Core (3.11.174)'
    },
    # PDF.js — Web Worker (required for off-main-thread rendering)
    @{
        Url         = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        File        = 'pdf.worker.min.js'
        Description = 'PDF.js Worker (3.11.174)'
    },
    # OpenCV.js — includes WASM inline (no separate .wasm file needed)
    @{
        Url         = 'https://docs.opencv.org/4.8.0/opencv.js'
        File        = 'opencv.js'
        Description = 'OpenCV.js 4.8.0 (WASM bundle, ~8 MB – bitte warten)'
    },
    # Bootstrap CSS
    @{
        Url         = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css'
        File        = 'bootstrap.min.css'
        Description = 'Bootstrap 5.3.2 CSS'
    },
    # Bootstrap JS bundle (includes Popper.js)
    @{
        Url         = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js'
        File        = 'bootstrap.bundle.min.js'
        Description = 'Bootstrap 5.3.2 JS Bundle'
    }
)

# ============================================================
# Funktionen
# ============================================================

function Write-Header {
    param([string]$Text)
    Write-Host ''
    Write-Host ('=' * 60) -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host ('=' * 60) -ForegroundColor Cyan
    Write-Host ''
}

function Get-FileSizeLabel {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return '' }
    $bytes = (Get-Item $Path).Length
    if ($bytes -ge 1MB) { return ' ({0:F1} MB)' -f ($bytes / 1MB) }
    return ' ({0:F0} KB)' -f ($bytes / 1KB)
}

function Invoke-LibraryDownload {
    param(
        [string]$Url,
        [string]$File,
        [string]$Description
    )

    $fullPath = Join-Path $LibsDir $File

    if ((Test-Path $fullPath) -and -not $Force) {
        $size = Get-FileSizeLabel $fullPath
        Write-Host "  [SKIP] $Description$size (bereits vorhanden)" -ForegroundColor DarkGray
        Write-Host "         Verwende -Force zum Überschreiben." -ForegroundColor DarkGray
        return
    }

    Write-Host "  [....] $Description" -ForegroundColor Yellow -NoNewline

    try {
        # Use -UseBasicParsing for compatibility with older PowerShell / Windows versions
        Invoke-WebRequest -Uri $Url -OutFile $fullPath -UseBasicParsing

        $size = Get-FileSizeLabel $fullPath
        Write-Host "`r  [ OK ] $Description$size" -ForegroundColor Green
    }
    catch {
        Write-Host "`r  [FAIL] $Description" -ForegroundColor Red
        Write-Host "         Fehler: $_" -ForegroundColor Red
        Write-Host "         URL:    $Url" -ForegroundColor DarkRed
    }
}

# ============================================================
# Hauptprogramm
# ============================================================

Write-Header 'PSO Tool – Bibliotheken herunterladen'

# Sicherstellen dass libs/ existiert
if (-not (Test-Path $LibsDir)) {
    New-Item -ItemType Directory -Path $LibsDir | Out-Null
    Write-Host "  Ordner erstellt: $LibsDir" -ForegroundColor DarkGray
}

# Alle Bibliotheken herunterladen
foreach ($lib in $Libraries) {
    Invoke-LibraryDownload -Url $lib.Url -File $lib.File -Description $lib.Description
}

# ============================================================
# Abschlussbericht
# ============================================================

Write-Host ''
Write-Host ('=' * 60) -ForegroundColor Green
Write-Host '  Fertig!' -ForegroundColor Green
Write-Host ('=' * 60) -ForegroundColor Green
Write-Host ''
Write-Host '  Naechste Schritte:' -ForegroundColor White
Write-Host '    1. index.html im Browser oeffnen (Doppelklick)' -ForegroundColor White
Write-Host '    2. PDF laden' -ForegroundColor White
Write-Host '    3. Template laden (oder Beispiel-Template nutzen)' -ForegroundColor White
Write-Host '    4. Analyse starten' -ForegroundColor White
Write-Host ''
Write-Host '  Hinweis: Nach dem Download wird KEINE Internetverbindung benoetigt.' -ForegroundColor DarkGray
Write-Host ''

# Liste der heruntergeladenen Dateien
Write-Host '  Dateien in libs/:' -ForegroundColor DarkGray
Get-ChildItem $LibsDir | ForEach-Object {
    $size = Get-FileSizeLabel $_.FullName
    Write-Host "    $($_.Name)$size" -ForegroundColor DarkGray
}
Write-Host ''
