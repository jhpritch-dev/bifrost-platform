@echo off
REM ============================================================
REM BIFROST k3d Port-Forward Startup Script
REM Waits for k3d cluster to be ready, then launches all
REM port-forwards needed for control plane + embeddings.
REM
REM Scheduled task: K3d-PortForwards-Startup
REM Machine: Hearth (192.168.2.4)
REM ============================================================

REM Log file for troubleshooting
set LOGFILE=L:\k3d-portforward\startup.log
echo [%date% %time%] Port-forward startup script launched >> %LOGFILE%

REM Wait for Docker + k3d to be ready (up to 5 minutes)
set /a TRIES=0
set /a MAX_TRIES=30

:WAIT_LOOP
set /a TRIES+=1
echo [%date% %time%] Waiting for k3d cluster (attempt %TRIES%/%MAX_TRIES%)... >> %LOGFILE%
kubectl get nodes --no-headers 2>nul | findstr /i "Ready" >nul 2>&1
if %ERRORLEVEL%==0 goto CLUSTER_READY
if %TRIES% geq %MAX_TRIES% (
    echo [%date% %time%] TIMEOUT: k3d cluster not ready after %MAX_TRIES% attempts >> %LOGFILE%
    exit /b 1
)
timeout /t 10 /nobreak >nul
goto WAIT_LOOP

:CLUSTER_READY
echo [%date% %time%] k3d cluster is ready >> %LOGFILE%

REM Extra wait for pods to stabilize after node ready
timeout /t 15 /nobreak >nul

REM Kill any stale port-forwards from previous run
taskkill /F /IM "kubectl.exe" /FI "WINDOWTITLE eq k3d-pf-*" 2>nul

REM Launch port-forwards
echo [%date% %time%] Starting port-forwards... >> %LOGFILE%

start "k3d-pf-observer" /B kubectl port-forward svc/observer -n inference-platform 8081:8081 --address 0.0.0.0
echo [%date% %time%] Started: Observer 8081:8081 >> %LOGFILE%

start "k3d-pf-broadcaster" /B kubectl port-forward svc/broadcaster -n inference-platform 8092:8090 --address 0.0.0.0
echo [%date% %time%] Started: Broadcaster 8092:8090 >> %LOGFILE%

start "k3d-pf-embeddings" /B kubectl port-forward svc/ollama-embed -n context 11435:11434 --address 0.0.0.0
echo [%date% %time%] Started: Embeddings 11435:11434 >> %LOGFILE%

REM Wait for port-forwards to establish
timeout /t 5 /nobreak >nul

REM Verify
echo [%date% %time%] Verifying port-forwards... >> %LOGFILE%
curl -s -o nul -w "Observer :8081 -> HTTP %%{http_code}\n" http://localhost:8081/health >> %LOGFILE% 2>&1
curl -s -o nul -w "Broadcaster :8092 -> HTTP %%{http_code}\n" http://localhost:8092/system/status >> %LOGFILE% 2>&1
curl -s -o nul -w "Embeddings :11435 -> HTTP %%{http_code}\n" http://localhost:11435/api/tags >> %LOGFILE% 2>&1

echo [%date% %time%] Port-forward startup complete >> %LOGFILE%

