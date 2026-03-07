$SRC  = "L:\bifrost-portal-src"
$DIST = "L:\bifrost-portal"

if (-not (Test-Path "$SRC\package.json")) {
    Write-Host "First run — scaffolding..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $SRC -Force | Out-Null
    docker run --rm -v "${SRC}:/app" -w /app node:20-alpine sh -c "npm create vite@latest . -- --template react --yes && npm install recharts"
    Write-Host "Scaffold complete." -ForegroundColor Green
    Write-Host "1. Copy BifrostPortal.jsx --> $SRC\src\BifrostPortal.jsx"
    Write-Host "2. Replace $SRC\src\App.jsx with:"
    Write-Host "     import BifrostPortal from './BifrostPortal'"
    Write-Host "     export default function App() { return <BifrostPortal /> }"
    Write-Host "3. Re-run: & 'L:\build-portal.ps1'"
    exit
}

Write-Host "Building..." -ForegroundColor Cyan
docker run --rm -v "${SRC}:/app" -w /app node:20-alpine sh -c "npm install --silent && npm run build"
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed." -ForegroundColor Red; exit 1 }

New-Item -ItemType Directory -Path $DIST -Force | Out-Null
Remove-Item "$DIST\assets\*" -Force -ErrorAction SilentlyContinue
Copy-Item "$SRC\dist\*" $DIST -Recurse -Force
Write-Host "Done. http://192.168.2.4:3110" -ForegroundColor Green



