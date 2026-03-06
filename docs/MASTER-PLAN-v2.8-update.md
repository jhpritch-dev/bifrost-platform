# MASTER-PLAN v2.8 — Update Patch
# Apply these changes to MASTER-PLAN v2.3 (or the latest version on disk)
# Date: 2026-02-26
# Summary: Phase 0 COMPLETE, Phase 1 COMPLETE

---

## Header Update

```
> **Version:** 2.8
> **Date:** 2026-02-26
> **Status:** Phase 0 Complete ✅, Phase 1 Complete ✅, Phase 2 Awaiting Forge
> **Author:** John + Claude (Architect Mode)
```

---

## §2.2 Hearth — Replace entire section

### 2.2 Hearth — Always-On Server

| Component | Spec |
|-----------|------|
| CPU | AMD Ryzen 7 5800G (8C/16T, Zen 3) |
| dGPU | **AMD Radeon RX 5700 XT (8GB VRAM, RDNA1, Vulkan)** |
| iGPU | AMD Radeon Vega 8 (~1.9 TFLOPS, GCN 5.0, gfx902) — **tabled, WSL2 incompatible** |
| RAM | 32GB DDR4 |
| PSU | **650W (upgraded for 5700 XT)** |
| Storage | L:\ 230GB NVMe SSD (Docker data + model cache), F:\ Storage Spaces pool (cold model library) |
| Network | 2.5GbE, SMB shares: `\\HEARTH\net-ssd`, `\\HEARTH\models` |
| Services | Docker Desktop (WSL2), k3d cluster, **Dual Ollama (inference + embed)**, Prometheus, Grafana |
| UPS | Battery-backed, runs 24/7 |
| Role | Infrastructure backbone — **always-on Tier 1a inference**, monitoring, embeddings, GitOps, storage |

**RX 5700 XT — always-on inference GPU.** Installed 2026-02-25. Runs Ollama on port 11434 with `OLLAMA_VULKAN=1`, achieving ~54 tok/s with qwen2.5-coder:7b at 100% GPU offload. This gives BIFROST a dedicated always-on local inference tier (1a-hearth) that handles TRIVIAL and MODERATE requests 24/7 without touching Bifrost's GPU. `OLLAMA_KEEP_ALIVE=24h` keeps the model hot.

**Dual Ollama instances:**
- Port 11434: Inference GPU (5700 XT Vulkan) — qwen2.5-coder:7b + qwen2.5-coder:7b-ctx4k
- Port 11435: Embedding CPU (k3d) — nomic-embed-text

**Vega 8 iGPU — tabled.** ROCm incompatible with WSL2 DirectX bridge on Hearth's configuration. Revisit in Phase 3 with native Linux or dedicated container approach.

**Coexisting Docker services:** Immich, Home Assistant, Jellyfin, OwnCloud, Watchtower. All protected with Watchtower labels to prevent k3d conflicts.

---

## §4.1 The Endpoint Roster — Update to Nine Endpoints

### 4.1 The Nine-Endpoint Roster

The platform operates nine inference endpoints spanning the full cognitive capability spectrum (6 local + 3 cloud).

**Local Endpoints (6):**

| Tier | Model | Machine | Speed | Role | Request % |
|------|-------|---------|-------|------|-----------|
| **1a-hearth** | qwen2.5-coder:7b | Hearth (5700 XT) | ~54 tok/s | **Always-on autocomplete, first in cascade** | ~40% |
| **1a-coder** | qwen2.5-coder:7b | Bifrost (9070 XT) | ~55-70 tok/s | Fast autocomplete, cascade fallback | ~20% |
| **1a-instruct** | qwen2.5:7b-instruct | Bifrost (9070 XT) | ~50-60 tok/s | Reasoning, summarization, context distillation | ~5% |
| **1b** | qwen2.5-coder:14b | Bifrost / Forge | ~30-40 tok/s | Quality code generation, refactoring | ~15% |
| **2** | qwen2.5-coder:32b | Forge | ~15-20 tok/s | Multi-file refactoring, complex logic | ~5% |
| **2.5** | qwen2.5:72b (or equivalent) | Forge | ~4-8 tok/s | Architecture, deep reasoning, task decomposition | ~5% |

**Cloud Endpoints (3):**

| Tier | Provider | Model | Specialty | Request % |
|------|----------|-------|-----------|-----------|
| **3-Claude** | Anthropic | claude-sonnet-4-5 | Architecture, code review, frontier reasoning | ~5% |
| **3-Gemini** | Google | gemini-2.5-flash | Massive context, COMPLEX review | ~3% |
| **3-Fast** | Groq | llama-3.3-70b-versatile | Fast MODERATE cloud fallback | ~2% |

---

## §5.4 Control Plane Implementation Status — Replace

### 5.4 Implementation Status

| Component | Status | Deployment | Notes |
|-----------|--------|------------|-------|
| Observer v3 | ✅ Deployed | Hearth k3d (port-forward :8081 → NodePort 30081) | 1,850+ cycles, 30s poll interval. Scheduled task auto-starts port-forward on logon. |
| Broadcaster v3 | ✅ Deployed | Hearth k3d (NodePort :8090 → 30080) | WORKSHOP mode, 16h+ uptime. Serves /system/status API. |
| Arbiter v3 | ✅ Deployed | Bifrost :8082 | Debounce 30s, WORKSHOP confirmed. Polls Broadcaster, provides /mode API to Router. |
| Router v1 | ✅ Deployed | Bifrost :8080 | TWO_PASS strategy, four-band classification, cascade routing across two local GPUs + three cloud providers. |

---

## §6 Complexity Router — Expand

### 6.1 Routing Architecture

The Router sits at Bifrost:8080 and intercepts all inference requests. It operates as an OpenAI-compatible proxy (`/v1/chat/completions`, `/v1/completions`, `/v1/models`).

**Three strategies:**

| Strategy | Use Case | Behavior |
|----------|----------|----------|
| **INTERACTIVE** | Chat, autocomplete | Single-point routing, optimize for latency |
| **TWO_PASS** | COMPLEX+ requests | Local draft → cloud review. Confidence gate skips review if draft is strong. |
| **AUTOPILOT** | Multi-step tasks | Full autonomous pipeline (Phase 3) |

**TWO_PASS strategy (implemented):**
- Local tier generates a draft response
- Cloud reviewer (Groq for MODERATE, Gemini for COMPLEX, Claude for FRONTIER) reviews and enhances
- Confidence gate: if draft meets minimum response ratio (0.3), minimum tokens (20), no truncation, and no hedging → skip cloud review
- Router overhead: ~59ms classification + routing

### 6.3 Cascade Logic — WORKSHOP Mode (Current)

Two local GPUs (Hearth 5700 XT + Bifrost 9070 XT) with cloud escalation:

```
TRIVIAL:   1a-hearth → 1a-coder
MODERATE:  1a-hearth → 1a-coder → 1b (14B) → 3-fast (Groq)
COMPLEX:   3-gemini
FRONTIER:  3-claude
```

**Measured performance (2026-02-26):**
- 80% local routing achieved on first real session
- TRIVIAL: ~650ms TTFT, ~5.7s total via 1a-hearth
- MODERATE: ~1.7s TTFT, ~11.7s total via 1a-hearth
- COMPLEX: routes to Gemini cloud review
- Zero escalations needed (first tier handles all local requests)

### 6.5 Cloud Provider Configuration

| Provider | Status | Model | API Key |
|----------|--------|-------|---------|
| Groq | ✅ Configured | llama-3.3-70b-versatile | GROQ_API_KEY |
| Gemini | ✅ Configured | gemini-2.5-flash | GEMINI_API_KEY |
| Anthropic | ✅ Configured | claude-sonnet-4-5 | ANTHROPIC_API_KEY |

---

## §9 Monitoring & Observability — Update

### 9.1 Prometheus Metrics

**Router metrics (bifrost_*):**
- `bifrost_router_info` — mode, profile, version gauge
- `bifrost_requests_total` — counter by band + tier + success
- `bifrost_band_total` — counter per complexity band
- `bifrost_tier_total` — counter per inference tier
- `bifrost_escalations_total` — tier fallback events
- `bifrost_cloud_requests_total` — cloud-routed requests
- `bifrost_local_requests_total` — locally-handled requests
- `bifrost_request_latency_ms` — histogram by band + tier (buckets: 10ms to 30s)
- `bifrost_active_mode` — gauge per mode (1=active)
- `bifrost_local_percentage` — current local routing ratio
- `bifrost_uptime_seconds` — router uptime

### 9.2 Grafana Dashboards

| Dashboard | UID | Status | Contents |
|-----------|-----|--------|----------|
| **BIFROST Platform Overview** | bifrost-platform-overview | ✅ Live (provisioned) | Infrastructure health tiles, service availability, control plane stats |
| **BIFROST Routing Analytics** | bifrost-routing | ✅ Live | Band/tier pie charts, local % gauge, request rate, latency percentiles, active mode |

---

## §10 Workflow Integration — Update

### 10.1 Slash Commands (implemented)

Commands work via Router API (`POST /v1/chat/completions` with `/command` as message content). Continue.dev wraps messages with system context, so commands fire via direct API calls, not through Continue chat.

| Command | Action | Status |
|---------|--------|--------|
| `/status` | Mode, tiers, profiles, session stats | ✅ Live |
| `/review [on\|off\|status]` | Toggle TWO_PASS review mode | ✅ Live |
| `/bifrost [light\|dual\|heavy]` | Switch Bifrost GPU profile | ✅ Live |
| `/mode` | Mode transition history from Arbiter | ✅ Live |
| `/cost [today\|week\|month]` | Cloud API spend report with savings estimate | ✅ Live |
| `/cascade [band]` | Show routing cascade for current mode | ✅ Live |
| `/help` | Command reference | ✅ Live |

### 10.3 Continue.dev Configuration (Phase 1 — Active)

```yaml
name: BIFROST Router
version: 2.0.0
schema: v1
models:
  - name: BIFROST Auto-Route        # Complexity-routed via Router
    provider: openai
    model: bifrost-auto
    apiBase: http://localhost:8080/v1
    apiKey: not-needed
  - name: Bifrost Local (9070 XT)   # Direct to Bifrost GPU
    provider: ollama
    model: qwen2.5-coder:7b
    apiBase: http://localhost:11434
  - name: Hearth Local (5700 XT)    # Direct to Hearth GPU
    provider: ollama
    model: qwen2.5-coder:7b
    apiBase: http://192.168.2.4:11434
tabAutocompleteModel:
  name: BIFROST Autocomplete
  provider: openai
  model: qwen2.5-coder:7b
  apiBase: http://localhost:8080/v1
  apiKey: not-needed
```

---

## §11.1 Bifrost Software — Update

| Software | BIFROST Role | Status |
|----------|-------------|--------|
| **Ollama** | Tier 1a-coder/1a-instruct/1b inference. Vulkan backend. Binds `0.0.0.0:11434`. | ✅ Running |
| **VS Code + Continue.dev** | Primary developer interface. Three model choices (Auto-Route, Bifrost Local, Hearth Local). | ✅ Configured |
| **BIFROST Router** | Complexity classification + cascade routing. Port 8080. D:\Projects\bifrost-router\ | ✅ Running |
| **BIFROST Arbiter** | Mode debounce + tier filtering. Port 8082. Same directory. | ✅ Running |
| **Start-Bifrost.bat** | One-click launcher: Ollama + Router + Arbiter + health check. | ✅ Created |
| **LM Studio** | Backup inference, model testing lab. | Installed |
| **PyTorch** | Underpins inference, custom model work. | Installed |
| **ComfyUI / Amuse** | Image generation (Phase 5+). | Installed |

---

## §12 Implementation Phases — Replace Phase 0 and Phase 1

### Phase 0: Base Infrastructure ✅ COMPLETE

**Goal:** Core services running on Hearth, Bifrost Ollama operational.
**Completed:** 2026-02-20

```
✅ Hearth k3d cluster running (namespace: inference-platform, monitoring)
✅ Ollama-embed deployed in k3d (nomic-embed-text, port 11435)
✅ ChromaDB deployed in k3d
✅ Enrichment API deployed in k3d
✅ Prometheus deployed in k3d (namespace: monitoring)
✅ Grafana deployed in k3d (admin/inference, port 3000→30000)
✅ Bifrost Ollama installed (Windows-native, Vulkan backend, AMD AI Bundle)
✅ Bifrost models pulled: qwen2.5-coder:7b, qwen2.5:7b-instruct, qwen2.5-coder:14b
✅ SMB shares configured: \\HEARTH\net-ssd, \\HEARTH\models
✅ Cold model storage established on F:\ (Storage Spaces)
✅ Docker Compose services coexisting with k3d (Watchtower labels)
✅ FluxCD bootstrapped on Hearth k3d
✅ Anthropic API key setup + tested
✅ GitHub repo created (jhpritch-dev/bifrost-platform)
✅ FluxCD → GitHub sync validated
✅ Grafana dashboard JSON committed to Git
✅ Vega 8 iGPU ROCm evaluated → incompatible with WSL2, tabled to Phase 3
✅ Install VS Code + Continue.dev extension on Bifrost
✅ Configure Continue.dev → localhost:11434 (Ollama direct, Phase 0 config)
✅ Validate autocomplete + chat working through local Ollama (B+ to A- grades)
✅ RAM disk optimization via ImDisk (25GB R:\ WARM+ tier, 7.4x model swap speedup)
✅ OLLAMA_MAX_LOADED_MODELS=1 tuning (prevents partial offload degradation)
⏳ Pull qwen2.5-coder:32b (deferred — Forge-tier model, not needed until Phase 2)
```

**Gate:** ✅ Hearth cluster healthy for 72h+, Bifrost models responding, FluxCD sync working.

### Phase 1: Control Plane + Routing ✅ COMPLETE

**Goal:** System is self-aware, reports its own state. Complexity routing operational.
**Completed:** 2026-02-26

```
✅ Observer v3 deployed to Hearth k3d (port 8081 via port-forward, scheduled task)
✅ Broadcaster v3 deployed to Hearth k3d (port 8090 via NodePort 30080)
✅ Arbiter v3 deployed to Bifrost (port 8082) — debounce 30s, WORKSHOP confirmed
✅ Validate mode detection (WORKSHOP confirmed by all signals)
✅ /system/status API live and returning correct state
✅ /status slash command working (via API)
✅ Grafana dashboard: Platform Overview (provisioned) + Routing Analytics (API-created)
✅ Transition logging active (Arbiter /transitions endpoint)
✅ Observer + Broadcaster manifests in Git → FluxCD auto-deploy
✅ Bifrost-side setup: model pulls, storage mapping, connectivity test
✅ Complexity Router deployed on Bifrost:8080 (OpenAI-compatible proxy)
✅ Four-band classification working (TRIVIAL/MODERATE/COMPLEX/FRONTIER)
✅ TWO_PASS routing strategy implemented and tested
✅ Cascade routing with two local GPUs (Hearth 5700 XT + Bifrost 9070 XT)
✅ 14B model added to MODERATE cascade
✅ Cloud providers configured: Groq ✓, Gemini ✓, Claude ✓
✅ Confidence gate operational (skips cloud review on strong local drafts)
✅ Continue.dev wired to Router :8080/v1 (three model choices)
✅ Slash commands: /status, /review, /bifrost, /mode, /cost, /cascade, /help
✅ Prometheus metrics: 11 bifrost_* metrics scraped from Router
✅ Grafana Routing Analytics dashboard live (band/tier pies, latency, local %)
✅ Start-Bifrost.bat launcher (Ollama + Router + Arbiter)
✅ Hearth RX 5700 XT installed and operational (always-on Tier 1a-hearth, ~54 tok/s)
✅ Observer port-forward auto-start via scheduled task on Hearth
✅ 80% local routing target achieved on first session
✅ QWEN-FIXES.md reference doc for local model code generation quality
```

**Gate:** ✅ System correctly detects WORKSHOP mode. Mode transitions logged. All state accessible via API. Complexity routing operational with 80% local target met.

### Phase 2: Forge Integration ⏳ (Awaiting Hardware)

**Goal:** Dock Forge, system auto-upgrades to JARVIS. Full tier hierarchy operational.

```
☐ Forge arrives and initial OS setup (headless, RDP)
☐ Ollama installed on Forge (Vulkan backend)
☐ Models pulled on Forge: 7B, 14B, 32B, 72B
☐ VGM set to 96GB for maximum VRAM allocation
☐ Observer probes Forge on LAN path → forge_lan_reachable
☐ Observer probes Forge on Tailscale path → forge_tailscale_reachable
☐ Arbiter handles WORKSHOP ↔ JARVIS transitions
☐ Drain + transition protocols validated (30s grace window)
☐ Tier 1b, 2, 2.5 routing active and tested
☐ Forge Profile F-Multi validated: 7B + 14B + 72B hot simultaneously
☐ Forge Profile F-Max validated: single large model (109B MoE or max quant 72B)
☐ Model sync from WARM storage (\\HEARTH\net-ssd)
☐ Update CASCADE_TABLES for JARVIS mode (full local tier hierarchy)
☐ Update TWO_PASS cascades for JARVIS (more local tiers before cloud)
☐ XDNA 2 NPU driver validation (ONNX Runtime + DirectML)
☐ Complexity classifier model deployed on Forge NPU
☐ E-local embedding model deployed on Forge NPU (nomic-embed-text ONNX)
☐ Observer signal: forge_npu_available returning TRUE
☐ Verify zero GPU contention: NPU inference concurrent with 72B generation
```

**Gate:** JARVIS mode operational. All tiers responding. Cascade routing validated end-to-end. Dock/undock cycle clean.

---

## Changelog — Append these entries

| Date | Version | Changes |
|------|---------|---------|
| 2026-02-20 | **2.4** | **Phase 0 COMPLETE, Phase 1 OPERATIONAL.** Observer v3 + Broadcaster v3 deployed to Hearth k3d (43h+ uptime). VS Code + Continue.dev installed and configured. RAMdisk WARM+ tier (R:\, 25GB ImDisk, 7.4x model swap speedup). OLLAMA_MAX_LOADED_MODELS=1 tuning. Complexity Router built and deployed on Bifrost:8080 with four-band classification and TWO_PASS strategy. All three cloud providers validated (Groq, Gemini, Claude). Prometheus metrics active with 18 bifrost_* counters. §6 expanded with TWO_PASS spec, confidence gate, cloud provider config. Phase 0 checklist: 19/22 items complete. |
| 2026-02-21 | **2.5** | **Cloud APIs fully validated.** TWO_PASS routing tested end-to-end with all providers. Continue.dev wired to Router :8080/v1 (first real routed coding session). Router README with API docs. Git sync scripts. Grafana Router dashboard imported. |
| 2026-02-25 | **2.6** | **Hearth RX 5700 XT installed.** Nine-endpoint roster (6 local + 3 cloud). Hearth now has dedicated inference GPU (~54 tok/s, Vulkan, always-on). Dual Ollama on Hearth (inference :11434 + embed :11435). CLOUD_PLUS mode added. Observer v3 updated with 13 signals including hearth_gpu_live. Broadcaster tier list updated with 1a-hearth. Four-tier storage formalized (HOT/WARM+/WARM/COLD). Claude Code + Remote Control integration spec (§10.3). PSU upgraded to 650W. |
| 2026-02-25 | **2.7** | **Arbiter v3 + slash commands code generated.** QWEN-FIXES.md reference doc (17 rules across 3 severity tiers for local model code generation). Arbiter prompt pack and slash commands prompt pack prepared for Qwen. |
| 2026-02-26 | **2.8** | **Phase 1 COMPLETE.** Arbiter v3 deployed on Bifrost:8082 — WORKSHOP mode confirmed via 30s debounce. Slash commands operational via API (/status, /review, /bifrost, /mode, /cost, /cascade, /help). Continue.dev config v2.0: three model choices (Auto-Route, Bifrost Local, Hearth Local) pointing at Router :8080/v1. WORKSHOP cascade updated: MODERATE now includes 14B (1a-hearth → 1a-coder → 1b → 3-fast). Gemini API key configured. Observer port-forward with scheduled task on Hearth logon. Grafana Routing Analytics dashboard created (bifrost-routing UID) with 12 panels: stat counters, band/tier pie charts, local % gauge, request rate, latency percentiles. Start-Bifrost.bat launcher. First real routing session: 80% local achieved, 11 requests, zero escalations. PowerShell execution policy fixed (Bypass). |

---

*End of v2.8 Update Patch*

| 2026-03-06 | **2.9** | **Forge online — JARVIS achieved.** Forge (Bosgame M5) arrived and fully configured. Win11 debloat applied. Ollama installed as scheduled task (BIFROST-Forge-Ollama), PATH set Machine-level. UMA Frame Buffer confirmed 96GB (AMD CBS → NBIO → GFX Configuration). All four models validated: qwen2.5:72b, qwen2.5-coder:32b, qwen2.5-coder:14b, qwen2.5-coder:7b. F-Multi profile live: 72B (57.6GB) + 7B (7.6GB) simultane
