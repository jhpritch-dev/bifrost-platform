@echo off
title BIFROST Platform Launcher
echo ============================================================
echo  BIFROST Distributed Inference Platform
echo  Starting services on Bifrost...
echo ============================================================
echo.

:: 1. Check Ollama
echo [1/3] Checking Ollama...
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo       Starting Ollama...
    start "" ollama serve
    timeout /t 8 /nobreak >nul
    echo       Ollama started
) else (
    echo       Ollama already running
)

:: 2. Start Router
echo [2/3] Starting Router on :8080...
start "BIFROST Router" cmd /k "cd /d D:\Projects\bifrost-router && python -m uvicorn main:app --host 0.0.0.0 --port 8080 --reload"
timeout /t 3 /nobreak >nul

:: 3. Start Arbiter
echo [3/3] Starting Arbiter on :8082...
start "BIFROST Arbiter" cmd /k "cd /d D:\Projects\bifrost-router && python -m uvicorn arbiter:app --host 0.0.0.0 --port 8082 --reload"
timeout /t 5 /nobreak >nul

:: 4. Health check
echo.
echo ============================================================
echo  Health Check
echo ============================================================
echo.

curl -s http://localhost:11434/api/tags >nul 2>&1 && (echo   Ollama:    UP) || (echo   Ollama:    DOWN)
curl -s http://localhost:8080/status >nul 2>&1 && (echo   Router:    UP) || (echo   Router:    STARTING...)
curl -s http://localhost:8082/health >nul 2>&1 && (echo   Arbiter:   UP) || (echo   Arbiter:   STARTING...)
curl -s http://192.168.2.4:8090/system/status >nul 2>&1 && (echo   Broadcaster: UP) || (echo   Broadcaster: DOWN)
curl -s http://192.168.2.4:8081/health >nul 2>&1 && (echo   Observer:  UP) || (echo   Observer:  DOWN)

echo.
echo  BIFROST ready. Router and Arbiter running in separate windows.
echo  Close this window when done checking.
echo ============================================================
pause
