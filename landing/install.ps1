param(
  [switch]$Uninstall,
  [string]$Version = "latest",
  [string]$RepoOwner = "caya8205-2",
  [string]$RepoName = "avpull"
)

$AppDir = "$env:LOCALAPPDATA\avpull"
$BinPath = Join-Path $AppDir 'avpull.exe'

function AddToPath {
  $current = [Environment]::GetEnvironmentVariable('PATH', 'User')
  if ($current -split ';' -notcontains $AppDir) {
    [Environment]::SetEnvironmentVariable('PATH', "$AppDir;$current", 'User')
    Write-Host "  Added to PATH (user-level)" -ForegroundColor Green
  }
}

function RemoveFromPath {
  $current = [Environment]::GetEnvironmentVariable('PATH', 'User')
  if ($current -and $current.Contains($AppDir)) {
    $new = ($current -split ';' | Where-Object { $_ -ne $AppDir }) -join ';'
    [Environment]::SetEnvironmentVariable('PATH', $new, 'User')
  }
}

function Dl($url, $out) {
  Write-Host "  Downloading $(Split-Path $url -Leaf) ..." -NoNewline
  $wc = New-Object System.Net.WebClient
  $wc.DownloadFile($url, $out)
  Write-Host " done" -ForegroundColor Green
}

function DoUninstall {
  Write-Host "Removing avpull ..." -ForegroundColor Yellow
  if (Test-Path $AppDir) { Remove-Item $AppDir -Recurse -Force; Write-Host "  Removed $AppDir" -ForegroundColor Green }
  RemoveFromPath
  Write-Host ""
  Write-Host "avpull uninstalled." -ForegroundColor Green
}

# ── Uninstall flow ────────────────────────────────────────
if ($Uninstall) { DoUninstall; return }

# ── Already installed? ────────────────────────────────────
if (Test-Path $BinPath) {
  Write-Host "avpull is already installed." -ForegroundColor Yellow
  Write-Host "  [U]ninstall   - remove avpull"
  Write-Host "  [R]einstall   - overwrite files"
  Write-Host "  [C]ancel      - do nothing"
  $key = (Read-Host "Choice").ToUpper()
  if ($key -eq 'U') { DoUninstall; return }
  if ($key -ne 'R') { Write-Host "Cancelled." -ForegroundColor Gray; return }
}

# ── Install flow ──────────────────────────────────────────
if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }

$scriptPath = if ($MyInvocation.MyCommand.Path) { Split-Path $MyInvocation.MyCommand.Path -Parent } else { $null }
$localExe = if ($scriptPath) { Join-Path $scriptPath 'avpull.exe' } else { $null }

if ($localExe -and (Test-Path $localExe)) {
  Write-Host "Installing from local files ..." -ForegroundColor Cyan
  Copy-Item -LiteralPath $localExe -Destination $BinPath -Force
  Write-Host "  avpull.exe" -ForegroundColor Green
  $localFfmpeg = Join-Path $scriptPath 'ffmpeg.exe'
  if (Test-Path $localFfmpeg) {
    Copy-Item -LiteralPath $localFfmpeg -Destination (Join-Path $AppDir 'ffmpeg.exe') -Force
    Write-Host "  ffmpeg.exe" -ForegroundColor Green
  } else {
    Write-Host "  WARNING: ffmpeg.exe not found, must be in PATH" -ForegroundColor Yellow
  }
} else {
  Write-Host "Fetching release info from GitHub ..." -ForegroundColor Cyan
  
  # Determine download URL based on version
  if ($Version -eq "latest") {
    $apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/latest"
  } else {
    $apiUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/releases/tags/$Version"
  }
  
  try {
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "avpull-installer" }
    $baseUrl = "https://github.com/$RepoOwner/$RepoName/releases/download/$($release.tag_name)"
    
    Write-Host "  Installing version $($release.tag_name) ..." -ForegroundColor Green
    Dl "$baseUrl/avpull.exe" $BinPath
    Dl "$baseUrl/ffmpeg.exe" (Join-Path $AppDir 'ffmpeg.exe')
  } catch {
    Write-Host ""
    Write-Host "ERROR: Failed to fetch release from GitHub." -ForegroundColor Red
    Write-Host "Make sure the repository has published releases." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You can also download manually from:" -ForegroundColor Cyan
    Write-Host "https://github.com/$RepoOwner/$RepoName/releases" -ForegroundColor White
    exit 1
  }
}

AddToPath
Write-Host ""
Write-Host "avpull installed!" -ForegroundColor Cyan
Write-Host "Open a new terminal and run: avpull --help" -ForegroundColor White
