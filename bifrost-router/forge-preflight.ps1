# forge-preflight.ps1 — BIFROST Forge Pre-Flight
# Run before JARVIS-OFFLINE validation or undocking
# [Forge] powershell -ExecutionPolicy Bypass -File C:\Users\jhpri\forge-preflight.ps1

Write-Host "`n=== BIFROST Forge Pre-Flight ===" -ForegroundColor Cyan

$pass = 0; $fail = 0

function Check($label, $ok, $detail="") {
    if ($ok) { Write-Host "[OK]  $label $detail" -ForegroundColor Green; $script:pass++ }
    else      { Write-Host "[FAIL] $label $detail" -ForegroundColor Red;   $script:fail++ }
}

$ollama = try { Invoke-RestMethod http://localhost:11434/api/tags -TimeoutSec 3 } catch { $null }
Check "Ollama :11434" ($ollama -ne $null)

$models = $ollama.models | ForEach-Object { $_.name.Split(":")[0] }
foreach ($m in @("bifrost-t2","bifrost-t2p5","qwen2.5-coder:14b","qwen2.5:72b")) {
    $base = $m.Split(":")[0]
    Check "Model: $m" ($models -contains $base)
}

$lemonade = try { Invoke-RestMethod http://localhost:8000/api/v1/models -TimeoutSec 3 } catch { $null }
Check "Lemonade :8000 (NPU)" ($lemonade -ne $null)

$npuModels = $lemonade.data | ForEach-Object { $_.id }
Check "NPU model: Qwen3-1.7b-FLM" ($npuModels -contains "Qwen3-1.7b-FLM")

Write-Host "`nResult: $pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) {"Green"} else {"Yellow"})
if ($fail -eq 0) { Write-Host "Forge READY for JARVIS-OFFLINE" -ForegroundColor Green }
else             { Write-Host "Resolve failures before going offline" -ForegroundColor Yellow }
