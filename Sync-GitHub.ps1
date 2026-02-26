# === BIFROST GitHub Sync ===
# Run on HEARTH. Pulls Router code from Bifrost via SMB, commits everything, pushes.
# Prerequisites: Bifrost must be on and accessible at 192.168.2.33

param(
    [string]$RepoPath = "$HOME\repos\bifrost-platform",
    [string]$BifrostRouter = "\\192.168.2.33\C$\Users\jhpri\Projects\bifrost-router",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Write-Host "`n=== BIFROST GitHub Sync ===" -ForegroundColor Cyan
Write-Host "Repo: $RepoPath" -ForegroundColor DarkGray
Write-Host "Source: $BifrostRouter" -ForegroundColor DarkGray

# --- 0. Verify access ---
Write-Host "`n[0/5] Checking connectivity..." -ForegroundColor Yellow

if (-not (Test-Path $RepoPath)) {
    Write-Host "  Repo not found at $RepoPath" -ForegroundColor Red
    exit 1
}

# Try default admin share first, fall back to D$ share
$routerSource = $null
$tryPaths = @(
    "",
    "\\192.168.2.33\D$\Projects\bifrost-router",
    "\\192.168.2.33\C$\Users\jhpri\Projects\bifrost-router",
    "\\192.168.2.33\d\Projects\bifrost-router"
)
foreach ($p in $tryPaths) {
    if (Test-Path "$p\main.py" -ErrorAction SilentlyContinue) {
        $routerSource = $p
        break
    }
}

if (-not $routerSource) {
    Write-Host "  Cannot reach Bifrost Router directory via SMB." -ForegroundColor Red
    Write-Host "  Tried: $($tryPaths -join ', ')" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Options:" -ForegroundColor Yellow
    Write-Host "    1. Share D:\Projects on Bifrost:" -ForegroundColor White
    Write-Host "       New-SmbShare -Name 'Projects' -Path 'D:\Projects' -FullAccess 'Everyone'" -ForegroundColor DarkGray
    Write-Host "    2. Or copy manually:" -ForegroundColor White
    Write-Host "       Copy router files to $RepoPath\services\router\" -ForegroundColor DarkGray
    exit 1
}
Write-Host "  Bifrost Router found at: $routerSource" -ForegroundColor Green

# --- 1. Create repo directory structure ---
Write-Host "`n[1/5] Setting up repo structure..." -ForegroundColor Yellow

$dirs = @(
    "$RepoPath\services\router",
    "$RepoPath\services\router\backends",
    "$RepoPath\docs"
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "  Created: $($d.Replace($RepoPath, '.'))" -ForegroundColor Green
    }
}

# --- 2. Sync Router code from Bifrost ---
Write-Host "`n[2/5] Syncing Router code from Bifrost..." -ForegroundColor Yellow

$routerFiles = @(
    "main.py",
    "config.py",
    "classifier.py",
    "commands.py",
    "metrics.py",
    "strategies.py",
    "review_prompts.py",
    "arbiter.py",
    "requirements.txt",
    "Start-Router.ps1",
    "Start-Bifrost.bat",
    "QWEN-FIXES.md"
)

$copied = 0
foreach ($f in $routerFiles) {
    $src = Join-Path $routerSource $f
    $dst = Join-Path "$RepoPath\services\router" $f
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Host "  Synced: services/router/$f" -ForegroundColor Green
        $copied++
    } else {
        Write-Host "  Skipped (not found): $f" -ForegroundColor DarkGray
    }
}

# Backends subdirectory
$backendFiles = @("ollama.py", "anthropic.py", "openai_compat.py", "__init__.py")
foreach ($f in $backendFiles) {
    $src = Join-Path "$routerSource\backends" $f
    $dst = Join-Path "$RepoPath\services\router\backends" $f
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        Write-Host "  Synced: services/router/backends/$f" -ForegroundColor Green
        $copied++
    }
}

Write-Host "  Total files synced: $copied" -ForegroundColor Cyan

# --- 3. Copy MASTER-PLAN update if present ---
Write-Host "`n[3/5] Checking for MASTER-PLAN update..." -ForegroundColor Yellow

$mpUpdate = "$HOME\Downloads\MASTER-PLAN-v2.8-update.md"
if (-not (Test-Path $mpUpdate)) {
    $mpUpdate = "$HOME\MASTER-PLAN-v2.8-update.md"
}
if (Test-Path $mpUpdate) {
    Copy-Item $mpUpdate "$RepoPath\docs\MASTER-PLAN-v2.8-update.md" -Force
    Write-Host "  Copied MASTER-PLAN v2.8 update to docs/" -ForegroundColor Green
} else {
    Write-Host "  No MASTER-PLAN update found in Downloads or Home (optional)" -ForegroundColor DarkGray
}

# --- 4. Update .gitignore ---
Write-Host "`n[4/5] Updating .gitignore..." -ForegroundColor Yellow

$gitignorePath = Join-Path $RepoPath ".gitignore"
$gitignoreContent = @"
# OS
.DS_Store
Thumbs.db
Desktop.ini

# Secrets
*.key
*.pem
.env
.env.*
!.env.example

# IDE
.vscode/settings.json
.idea/

# Python
__pycache__/
*.pyc
.venv/
venv/
*.egg-info/

# Node
node_modules/

# Model files (too large for git)
*.gguf
*.bin
*.safetensors

# Logs
*.log

# SQLite
*.sqlite
"@
$gitignoreContent | Set-Content $gitignorePath -Encoding UTF8
Write-Host "  .gitignore updated" -ForegroundColor Green

# --- 5. Git commit and push ---
Write-Host "`n[5/5] Committing and pushing..." -ForegroundColor Yellow

Push-Location $RepoPath

git add .
$status = git status --porcelain
if (-not $status) {
    Write-Host "  Nothing to commit — repo is up to date" -ForegroundColor Green
    Pop-Location
    exit 0
}

Write-Host "  Changed files:" -ForegroundColor DarkGray
git status --short | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

if ($DryRun) {
    Write-Host "`n  DRY RUN — skipping commit and push" -ForegroundColor Yellow
    Pop-Location
    exit 0
}

git commit -m "feat: Phase 1 COMPLETE — Router, Arbiter, full control plane

Services synced from Bifrost:
- Router v1 (main.py, config.py, classifier.py, commands.py, metrics.py, strategies.py)
- Arbiter v3 (arbiter.py)
- Backends (ollama.py, anthropic.py, openai_compat.py)
- Start-Bifrost.bat launcher
- QWEN-FIXES.md (local model code generation reference)

MASTER-PLAN v2.8 update:
- Phase 0 COMPLETE (2026-02-20), Phase 1 COMPLETE (2026-02-26)
- Hearth RX 5700 XT: always-on Tier 1a-hearth (~54 tok/s)
- Control plane: Observer+Broadcaster (Hearth) + Router+Arbiter (Bifrost)
- 4-band complexity routing, TWO_PASS strategy, 80% local achieved
- 3 cloud providers (Groq/Gemini/Claude)
- Grafana Routing Analytics dashboard (12 panels)
- Slash commands, Continue.dev v2.0 config"

git push

Pop-Location

Write-Host "`n=== Sync Complete ===" -ForegroundColor Cyan
Write-Host "  View at: https://github.com/jhpritch-dev/bifrost-platform" -ForegroundColor Green
Write-Host ""
