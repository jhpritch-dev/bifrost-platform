# Test-RFPEngine-v1.ps1 - BIFROST RFP Engine Demo Test
$ErrorActionPreference = "Stop"
$RouterUrl = "http://localhost:8080"
$OutputDir = "D:\Projects\bifrost-router\rfp-outputs"
$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$DraftFile = "$OutputDir\KIPDA-proposal-draft-$Timestamp.txt"
$LogFile   = "$OutputDir\KIPDA-run-log-$Timestamp.json"

function Write-Step { param($msg) Write-Host "`n[$([datetime]::Now.ToString('HH:mm:ss'))] $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "  ERR $msg" -ForegroundColor Red }
function Write-Data { param($msg) Write-Host "      $msg" -ForegroundColor Gray }

if (-not (Test-Path $OutputDir)) { New-Item -ItemType Directory -Path $OutputDir | Out-Null }

Write-Host ""
Write-Host "  +======================================================+" -ForegroundColor Magenta
Write-Host "  |  BIFROST RFP Engine -- KIPDA Employee Benefits Demo  |" -ForegroundColor Magenta
Write-Host "  |  5 sections . INTERACTIVE mode . local-first routing |" -ForegroundColor Magenta
Write-Host "  +======================================================+" -ForegroundColor Magenta

Write-Step "Fleet Status Check"
try {
    $ps = Invoke-RestMethod -Uri "http://192.168.2.4:8092/api/ps" -TimeoutSec 5
    foreach ($node in @("bifrost","hearth","hearth_vega8","forge")) {
        $nd = $ps.$node
        if ($nd -and $nd.models -and $nd.models.Count -gt 0) {
            $models = ($nd.models | ForEach-Object { $_.name }) -join ", "
            Write-OK "$node -- $models"
        } elseif ($nd) { Write-Warn "$node -- online, no models loaded"
        } else { Write-Warn "$node -- no data" }
    }
} catch { Write-Warn "Broadcaster unreachable -- skipping fleet check" }

try {
    $rs = Invoke-RestMethod -Uri "http://localhost:8080/status" -TimeoutSec 5
    Write-OK "Router -- mode=$($rs.mode) strategy=$($rs.strategy)"
} catch { Write-Warn "Router unreachable -- is it running on :8080?" }

Write-Host ""
Write-Host "  Ready to generate 5-section proposal for KIPDA Employee Benefits RFP." -ForegroundColor White
Write-Host "  Switch to Portal / OBS now if recording." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Press any key to begin..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host ""

$RFP = "REQUEST FOR PROPOSALS -- BROKER SERVICES FOR EMPLOYEE BENEFITS. " +
       "Issuer: KIPDA, Louisville KY. Approx 90 employees, 3-year contract, annual revenue 34M USD. " +
       "Benefits: dental, vision, life, short and long-term disability, supplemental (cancer, hospitalization, accident, critical illness). " +
       "Scope: analysis and reporting, liaison and problem intervention, compliance, annual renewal, employee communications. " +
       "Required sections: Firm Information, Services Defined, Evidence of Performance, Financial Proposal, Additional Information. " +
       "Evaluation criteria: Qualifications 30pct, Approach 25pct, References 20pct, Cost 15pct, Value-add 10pct."

$S1prompt = "Draft a professional proposal SECTION 1: FIRM INFORMATION responding to this RFP: " + $RFP + " Include firm overview, team structure, Louisville Kentucky presence, licensure confirmation, and key personnel bios. Mark gaps with PLACEHOLDER. 400-600 words."
$S2prompt = "Draft a professional proposal SECTION 2: SERVICES DEFINED responding to this RFP: " + $RFP + " Cover full scope delivery approach, client service model, response time commitments, HIPAA cybersecurity overview, compliance resources, benefits benchmarking. Mark gaps with PLACEHOLDER. 600-800 words."
$S3prompt = "Draft a professional proposal SECTION 3: EVIDENCE OF SUCCESSFUL PERFORMANCE responding to this RFP: " + $RFP + " Include three reference projects (use PLACEHOLDER for client names and contacts), Louisville-area employer experience, and implementation schedule with milestones. 500-700 words."
$S4prompt = "Draft a professional proposal SECTION 4: FINANCIAL PROPOSAL responding to this RFP: " + $RFP + " Include fee structure options (fixed fee vs commission-based), projected annual cost for 90 employees, compensation transparency, performance incentives. Mark all figures with PLACEHOLDER. 300-400 words."
$S5prompt = "Write a closing proposal section for this RFP: " + $RFP + " Include a short 150-word firm overview suitable as an opening summary, our software tools and platform, bonus services we offer beyond the stated scope, and why our firm is a good fit for KIPDA. Mark gaps with PLACEHOLDER. 500 words."

$Sections = @(
    @{ id=1; title="Section 1: Firm Information";                       prompt=$S1prompt },
    @{ id=2; title="Section 2: Services Defined";                       prompt=$S2prompt },
    @{ id=3; title="Section 3: Evidence of Performance";                prompt=$S3prompt },
    @{ id=4; title="Section 4: Financial Proposal";                     prompt=$S4prompt },
    @{ id=5; title="Section 5: Additional Information and Exec Summary"; prompt=$S5prompt }
)

$RunLog = [ordered]@{ run_start=""; run_end=""; total_time_s=0; sections_ok=0; sections_err=0; sections=@() }
$RunLog.run_start = [datetime]::Now.ToString("HH:mm:ss")
$DraftParts  = @()
$TotalTimeMs = 0

foreach ($section in $Sections) {
    Write-Step "Section $($section.id)/5 -- $($section.title)"
    $BodyObj = @{ messages=@(@{role="user";content=$section.prompt}); stream=$false; model="bifrost-auto" }
    $Body = $BodyObj | ConvertTo-Json -Depth 5 -Compress
    $SectionLog = [ordered]@{ section_id=$section.id; title=$section.title; status="pending"; latency_ms=0; word_count=0; error="" }
    $t0 = Get-Date

    try {
        $Response = Invoke-RestMethod `
            -Method Post `
            -Uri "$RouterUrl/v1/chat/completions" `
            -ContentType "application/json; charset=utf-8" `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($Body)) `
            -Headers @{ "X-Strategy"="INTERACTIVE" }

        $latency     = [Math]::Round(((Get-Date) - $t0).TotalMilliseconds)
        $TotalTimeMs += $latency
        $content     = $Response.choices[0].message.content
        $content     = ($content -replace "(?s)<think>.*?</think>", "").Trim()
        $wordCount   = ($content -split "\s+").Count
        $sep         = "=" * 80
        $DraftParts += "`n$sep`n$($section.title.ToUpper())`n$sep`n`n$content`n"
        $SectionLog.status     = "success"
        $SectionLog.latency_ms = $latency
        $SectionLog.word_count = $wordCount
        Write-OK "$($section.title) -- ${latency}ms . ~${wordCount} words"
        Write-Data ($content.Substring(0, [Math]::Min(120, $content.Length)) + "...")
    } catch {
        $latency     = [Math]::Round(((Get-Date) - $t0).TotalMilliseconds)
        $TotalTimeMs += $latency
        $errMsg      = $_.Exception.Message
        $sep         = "=" * 80
        $DraftParts += "`n$sep`n$($section.title.ToUpper()) -- GENERATION FAILED`n$sep`n`nFailed: $errMsg`n"
        $SectionLog.status     = "failed"
        $SectionLog.error      = $errMsg
        $SectionLog.latency_ms = $latency
        Write-Fail "$($section.title) failed: $errMsg"
    }

    $RunLog.sections += $SectionLog
    Start-Sleep -Milliseconds 500
}

Write-Step "Assembling draft proposal..."
$sep    = "=" * 80
$Header = "$sep`nPROPOSAL RESPONSE -- KIPDA EMPLOYEE BENEFITS BROKER RFP`nGenerated: $(Get-Date -Format 'MMMM d, yyyy')`nGenerated by: BIFROST RFP Engine (AI-assisted draft -- requires human review)`n$sep`n`nNOTE: All PLACEHOLDER fields require human input. Requires compliance review before submission.`n"
$FullDraft = $Header + ($DraftParts -join "")

# Post-processing cleanup
$FullDraft = $FullDraft -replace [char]0x2019, "'"   # right single quote
$FullDraft = $FullDraft -replace [char]0x2018, "'"   # left single quote
$FullDraft = $FullDraft -replace [char]0x201C, '"'   # left double quote
$FullDraft = $FullDraft -replace [char]0x201D, '"'   # right double quote
$FullDraft = $FullDraft -replace [char]0x2013, "-"   # en dash
$FullDraft = $FullDraft -replace [char]0x2014, "--"  # em dash
$FullDraft = $FullDraft -replace [char]0x00E2, ""    # stray a-circumflex artifacts
$FullDraft = $FullDraft -replace '(?m)^\*\*?Word Count[^*]*\*\*?.*$', ""   # Word count footers
$FullDraft = $FullDraft -replace '(?m)^\*Word Count[^*]*\*.*$', ""         # *Word Count: N* variant
$FullDraft = $FullDraft -replace '(?m)^---\s*$
', ""                      # trailing --- separators
$FullDraft = $FullDraft -replace 'KIPDA is pleased to present', 'We are pleased to present'
$FullDraft = $FullDraft -replace 'KIPDA proposes', 'We propose'
$FullDraft = $FullDraft -replace '
{3,}', "`n`n"                          # collapse excess blank lines

$FullDraft | Out-File -FilePath $DraftFile -Encoding utf8
Write-OK "Draft saved: $DraftFile"

$RunLog.run_end      = [datetime]::Now.ToString("HH:mm:ss")
$RunLog.total_time_s = [Math]::Round($TotalTimeMs / 1000, 1)
$RunLog.sections_ok  = @($RunLog.sections | Where-Object { $_.status -eq "success" }).Count
$RunLog.sections_err = @($RunLog.sections | Where-Object { $_.status -eq "failed" }).Count
$RunLog | ConvertTo-Json -Depth 5 | Out-File -FilePath $LogFile -Encoding utf8
Write-OK "Run log saved: $LogFile"

Write-Step "Run Summary"
Write-Data "Sections completed : $($RunLog.sections_ok) / $($Sections.Count)"
Write-Data "Total wall time    : $($RunLog.total_time_s)s"
Write-Data "Draft file         : $DraftFile"

if ($RunLog.sections_err -gt 0) {
    Write-Warn "$($RunLog.sections_err) section(s) failed -- check log"
} else {
    Write-Host ""
    Write-Host "  BIFROST RFP Engine demo complete." -ForegroundColor Green
    Start-Process notepad $DraftFile
}
Write-Host ""
