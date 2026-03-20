# BIFROST Router — Claude Code Context
## Project: bifrost-router · Primary machine: Bifrost (192.168.2.33)

---

## Fleet

| Machine | IP | Role | Key Hardware |
|---|---|---|---|
| Bifrost | 192.168.2.33 | Primary workstation / Router host | Ryzen 9 3950X · RX 9070XT 16GB · 64GB DDR4 |
| Hearth | 192.168.2.4 | Always-on server / k3d / storage | Ryzen 7 5800G · RX 5700XT 8GB · Vega8 iGPU · 64GB DDR4 |
| Forge | 192.168.2.50 | Portable / 72B / NPU | Ryzen AI Max+ 395 · Radeon 8060S 96GB · XDNA2 NPU · 128GB LPDDR5X |

---

## Service Ports

| Service | Host | Port |
|---|---|---|
| Router | Bifrost | 8080 |
| Arbiter | Bifrost | 8082 |
| MLM | Bifrost | 8083 |
| bifrost-shell MCP | Bifrost | 8086 |
| Lemonade-adapter (planned) | Bifrost | 8085 |
| Broadcaster | Hearth k3d | 8092 (port-fwd) |
| Observer | Hearth k3d | 8081 (port-fwd) |
| bifrost-kb (ChromaDB) | Hearth k3d | 8091 |
| Grafana | Hearth k3d | 3000 |
| Prometheus | Hearth k3d | 9090 |
| Portal | Hearth | 3110 |
| Ollama GPU | Bifrost / Hearth | 11434 |
| Ollama CPU classifier | Bifrost | 11435 |
| Ollama Vega8 | Hearth | 11436 |
| Lemonade NPU | Forge | 8000 |
| Ollama | Forge | 11434 |

---

## Tier → Model Assignments

| Tier | Model | Backend | Host |
|---|---|---|---|
| T_NPU | Qwen3-1.7b-FLM | Lemonade | Forge :8000 |
| T1A_HEARTH | qwen2.5-coder:7b-ctx4k | Ollama | Hearth :11434 |
| T1A_OVERFLOW | qwen3.5:4b | Ollama | Hearth Vega8 :11436 |
| T1A_CODER | qwen2.5-coder:7b | Ollama | Bifrost :11434 |
| T1A_INSTRUCT | qwen2.5:7b-instruct | Ollama | Bifrost :11434 |
| T1B | bifrost-interactive | Ollama | Bifrost :11434 |
| T2 | qwen2.5-coder:14b | Ollama | Forge :11434 |
| T2_5 | qwen2.5:72b | Ollama | Forge :11434 |
| T3_CLAUDE | claude-sonnet-4-6 | Anthropic | Cloud |
| T3_GEMINI | gemini-2.5-flash | OpenAI-compat | Cloud |
| T3_FAST | llama-3.3-70b-versatile | Groq | Cloud |

**Model family rules:**
- Qwen3 on Bifrost only (RDNA4 coopmat required)
- Qwen2.5 on Forge + Hearth (proven)
- Qwen3.5 validated on Hearth (4b on 5700XT, 9b reserved for Forge)

---

## Key Source Paths

| Item | Path |
|---|---|
| Router source | `D:\Projects\bifrost-router\` |
| Portal source | `L:\bifrost-portal-src\src\BifrostPortal.jsx` |
| Monorepo | `C:\Users\jhpri\repos\bifrost-platform\` |
| Telemetry logs | `F:\bifrost-logs\` (Hearth SMB share) |
| Portal build script | `L:\build-portal.ps1` |

---

## Patch Delivery Conventions

- **Python patch scripts** preferred over PowerShell multiline string replacements (fail silently)
- Use `encoding='utf-8-sig'` for files that may have BOM on Windows
- Always label commands with machine name — operator runs 1 keyboard/mouse across 3 machines
- Prefer single-line commands over multi-line pastes (multi-line paste accidents have occurred)
- k3d deploys: always `k3d image import <image> -c inference-platform` before rollout (`imagePullPolicy: Never`)
- Python is NOT installed on Hearth — all patches run from Bifrost or are pure PowerShell

---

## Operating Modes

`JARVIS` · `WORKSHOP` · `WORKSHOP_OFFLINE` · `WORKSTATION` · `REMOTE` · `NOMAD` · `CLOUD_PLUS` · `CLOUD_ONLY`

JARVIS = full fleet, zero cloud egress. WORKSHOP = Hearth-led, cloud over