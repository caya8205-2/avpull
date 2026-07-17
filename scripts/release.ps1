# Release Helper Script
# Usage: .\scripts\release.ps1 -Version "1.0.0"

param(
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop"

Write-Host "🚀 avpull Release Helper" -ForegroundColor Cyan
Write-Host "Version: v$Version" -ForegroundColor Yellow
Write-Host ""

# Validate version format
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "❌ Invalid version format. Use semantic versioning: 1.0.0" -ForegroundColor Red
    exit 1
}

# Check if tag already exists
$tagExists = git tag -l "v$Version"
if ($tagExists) {
    Write-Host "❌ Tag v$Version already exists!" -ForegroundColor Red
    exit 1
}

# Check for uncommitted changes
$status = git status --porcelain
if ($status) {
    Write-Host "❌ You have uncommitted changes:" -ForegroundColor Red
    Write-Host $status
    Write-Host ""
    $continue = Read-Host "Continue anyway? (y/N)"
    if ($continue -ne "y") {
        exit 1
    }
}

# Update package.json version
Write-Host "📝 Updating package.json..." -ForegroundColor Green
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$packageJson.version = $Version
$packageJson | ConvertTo-Json -Depth 100 | Set-Content "package.json"

# Sync version to cli.js and lockfile
Write-Host "🔄 Syncing version to cli.js..." -ForegroundColor Green
bun run version:sync

# Build
Write-Host "🔨 Building binary..." -ForegroundColor Green
bun run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed!" -ForegroundColor Red
    exit 1
}

# Copy ffmpeg
Write-Host "📦 Copying ffmpeg..." -ForegroundColor Green
node scripts/copy-ffmpeg.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ FFmpeg copy failed!" -ForegroundColor Red
    exit 1
}

# Verify artifacts
Write-Host "✅ Verifying artifacts..." -ForegroundColor Green
if (!(Test-Path "dist/avpull.exe")) {
    Write-Host "❌ avpull.exe not found in dist/" -ForegroundColor Red
    exit 1
}
if (!(Test-Path "dist/ffmpeg.exe")) {
    Write-Host "❌ ffmpeg.exe not found in dist/" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✨ Build successful!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Review changes: git diff" -ForegroundColor White
Write-Host "2. Commit: git add . && git commit -m 'chore: release v$Version'" -ForegroundColor White
Write-Host "3. Tag: git tag v$Version" -ForegroundColor White
Write-Host "4. Push: git push origin main --tags" -ForegroundColor White
Write-Host ""
Write-Host "Or run all at once:" -ForegroundColor Yellow
Write-Host "git add . && git commit -m 'chore: release v$Version' && git tag v$Version && git push origin main --tags" -ForegroundColor White
Write-Host ""

$autoCommit = Read-Host "Auto-commit and tag? (y/N)"
if ($autoCommit -eq "y") {
    Write-Host ""
    Write-Host "📝 Committing changes..." -ForegroundColor Green
    git add .
    git commit -m "chore: release v$Version"
    
    Write-Host "🏷️  Creating tag v$Version..." -ForegroundColor Green
    git tag "v$Version"
    
    Write-Host ""
    Write-Host "✅ Ready to push!" -ForegroundColor Green
    Write-Host "Run: git push origin main --tags" -ForegroundColor White
}
