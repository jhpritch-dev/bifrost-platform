# Start-K3dPortForwards-Watchdog.ps1
# BIFROST k3d Port-Forward Watchdog
# Monitors Observer, Broadcaster, and Embeddings port-forwards.
# Restarts any that die. Runs indefinitely as a scheduled task.
#
# Machine: Hearth (192.168.2.4)
# Scheduled task: K3d-PortForwards-Startup
# Replace: L:\k3d-portforward\start-k3d-portforwards.bat

$LOGFILE  = "L:\k3d-portforward\watchdog.log"
$INTERVAL = 15   # seconds between health checks

# Port-forward definitions
$Forwards = @(
    @{ Name = "observer";    Svc = "svc/observer";    NS = "inference-platform"; LocalPort = 8081; RemotePort = 8081; HealthUrl = "http://localhost:8081/health" },
    @{ Name = "broadcaster"; Svc = "svc/broadcaster"; NS = "inference-platform"; LocalPort = 8092; RemotePort = 8090; HealthUrl = "http://localhost:8092/system/status" },
    @{ Name = "embeddings";  Svc = "svc/ollama-embed"; NS = "context";           LocalPort = 11435; RemotePort = 11434; HealthUrl = "http://localhost:11435/api/tags" }
)

# Track running processes
$Jobs = @{}

function Write-Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $LOGFILE -Value $line
    Write-Host $line
}

function Wait-ForCluster {
    Write-Log "Waiting for k3d cluster to be ready..."
    $tries = 0
    while ($tries -lt 30) {
        $result = kubectl get nodes --no-headers 2>$null | Select-String "Ready"
        if ($result) {
            Write-Log "k3d cluster ready."
            Start-Sleep 15  # let pods stabilize
            return $true
        }
        $tries++
        Write-Log "  Not ready yet (attempt $tries/30)..."
        Start-Sleep 10
    }
    Write-Log "TIMEOUT: k3d cluster not ready. Exiting."
    return $false
}

function Start-Forward($fwd) {
    Write-Log "Starting port-forward: $($fwd.Name) ($($fwd.LocalPort):$($fwd.RemotePort))"
    $proc = Start-Process -FilePath "kubectl" `
        -ArgumentList @("port-forward", $fwd.Svc, "-n", $fwd.NS, "$($fwd.LocalPort):$($fwd.RemotePort)", "--address", "0.0.0.0") `
        -PassThru -WindowStyle Hidden
    return $proc
}

function Test-Forward($fwd) {
    try {
        $resp = Invoke-WebRequest -Uri $fwd.HealthUrl -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
        return $resp.StatusCode -lt 500
    } catch {
        return $false
    }
}

# --- Main ---
Write-Log "============================================"
Write-Log "BIFROST k3d Port-Forward Watchdog starting"
Write-Log "Check interval: ${INTERVAL}s"
Write-Log "============================================"

if (-not (Wait-ForCluster)) { exit 1 }

# Kill any stale kubectl port-forwards from previous runs
Get-Process kubectl -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

# Initial launch of all port-forwards
foreach ($fwd in $Forwards) {
    $Jobs[$fwd.Name] = Start-Forward $fwd
    Start-Sleep 1
}

Write-Log "All port-forwards launched. Watchdog active."

# Watchdog loop
while ($true) {
    Start-Sleep $INTERVAL

    foreach ($fwd in $Forwards) {
        $proc = $Jobs[$fwd.Name]
        $alive = $proc -and -not $proc.HasExited
        $healthy = Test-Forward $fwd

        if (-not $alive -or -not $healthy) {
            if (-not $alive) {
                Write-Log "DEAD: $($fwd.Name) process exited. Restarting..."
            } else {
                Write-Log "UNHEALTHY: $($fwd.Name) health check failed. Restarting..."
                $proc | Stop-Process -Force -ErrorAction SilentlyContinue
                Start-Sleep 1
            }
            $Jobs[$fwd.Name] = Start-Forward $fwd
            Start-Sleep 2
        }
    }
}

