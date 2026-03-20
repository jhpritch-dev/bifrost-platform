# BIFROST — Agent Behavioral Contract
## Shared context for all agent surfaces: Claude Code, AUTOPILOT, Decomposer, MCP tool servers, OpenClaw

---

## Project Purpose

BIFROST is a local-first distributed AI inference and orchestration platform spanning three home lab machines. It intelligently routes requests across a tiered model fleet based on cognitive complexity, targeting 80%+ local inference with cloud escalation only when necessary.

**Dual purpose:** Privacy-first AI development environment + portfolio demonstration of distributed systems, intelligent routing, and autonomous agent orchestration.

**Commercial angles:**
- RFP Engine: Privacy-first autonomous proposal generator for professional services / insurance / legal / healthcare
- AUTO Benchmark: Hardware-specific, agent-config-aware benchmark data product
- BIFROST Router: Open-core Apache 2.0 middleware with enterprise licensing potential

---

## Operating Modes

| Mode | Description |
|---|---|
| JARVIS | Full fleet, zero cloud egress — all tiers including NPU active |
| WORKSHOP | Hearth-led local inference, cloud overflow permitted |
| WORKSHOP_OFFLINE | Local only, no cloud — Hearth + Bifrost tiers only |
| WORKSTATION | Bifrost-only workstation mode |
| REMOTE | Tailscale remote access, latency-adjusted routing |
| NOMAD | Forge standalone, cloud fallback, no Hearth dependency |
| CLOUD_PLUS | Hearth local + aggressive cloud escalation |
| CLOUD_ONLY | All cloud, no local inference |

Current target mode: **JARVIS**. JARVIS-OFFLINE = JARVIS with verified zero outbound traffic.

---

## Routing Strategies

| Strategy | Behavior |
|---|---|
| INTERACTIVE | Single sequential call. Visible tier routing. Preferred for demos and IDE use. |
| TWO_PASS | Local draft + cloud review. Confidence gate skips cloud if draft passes checks. |
| AUTOPILOT | LangGraph: Decompose → fan-out (ThreadPoolExecutor) → assemble. For complex multi-step tasks. |

**AUTOPILOT decomposer:** Uses Forge 72B (T2_5) for decomposition. Fan-out via wave-based DAG. SQLite checkpointer. MAX_ATTEMPTS=3 per subtask. Verification harness: L1 non-empty → L2 keyword → L3 static analysis (ruff/mypy via bifrost-shell) → L4 semantic cosine similarity.

---

## Safety Constraints

1. **Never modify running service configs without explicit approval.** Prefer additive changes.
2. **No raw shell access in Ops Agent** — scoped MCP tool set only (bifrost-shell tools: `run_ruff`, `run_mypy`, `run_checks`).
3. **Cloud escalation requires mode check** — in JARVIS/WORKSHOP_OFFLINE, cloud tiers must not be used.
4. **Embed swaps require re-indexing** — high-cost operation, requires explicit approval before proceeding.
5. **Lemonade Server on Forge** — do NOT auto-update. NPU driver + FLM version coupling requires manual review.
6. **Multi-agent fan-out gate:** Check tool density + capability saturation + sequential dependency depth before allowing decomposition. Sequential reasoning tasks degrade under multi-agent variants.

---

## Tool Boundaries

### bifrost-shell MCP (`D:\Projects\bifrost-router\bifrost_shell.py`, port 8086)
- `run_ruff(file_path)` — lint Python file, return PASS/FAIL + issues
- `run_mypy(file_path)` — type-check Python file, return PASS/FAIL + error count
- `run_checks(file_path)` — run both ruff + mypy, return combined result

**Scope:** Static analysis only. No filesystem writes, no service restarts, no network calls.

### Planned MCP servers (Phase 3 registration)
- RAG server (bifrost-kb ChromaDB, port 8091)
- Filesystem server
- Git server

---

## Escalation Rules

1. Tier cascade walks the ordered list until one succeeds or all fail.
2. FAILED_NEEDS_HUMAN returned when all tiers exhausted and MAX_ATTEMPTS reached.
3. Static analysis failure in INTERACTIVE mode triggers re-prompt (same tier, one retry).
4. Distill node compresses escalation context to 3-5 bullets before next tier attempt.
5. FRONTIER band → T3_CLAUDE directly (no local attempt in JARVIS mode).

---

## Key Architectural Decisions

- BIFROST is a system-level MoE — manually curated fleet of specialized models bound by intelligent orchestration
- The orchestration layer (Router, Arbiter, control plane) is the engineering differentiator
- 30 tok/s QoL floor for interactive use — below 30 tok/s = background/AUTOPILOT only
- WARP mode = INTERACTIVE with `think=false` + no escalation (routing parameter, not model swap)
- Slot assignments fixed at hardware ceiling, not conditionally swapped
- Design before code — shell/nav/layout before filling surfaces

---

## Fleet Quick Reference

| Machine | IP | Primary Role |
|---|---|---|
| Bifrost | 192.168.2.33 | Router host, RX 9070XT, Qwen3 |
| Hearth | 192.168.2.4 | Always-on, k3d, 5700XT + Vega8, storage |
| Forge | 192.168.2.50 | 72B inference, NPU, 96GB unified VRAM |

---

*BIFROST AGENTS.md — companion to CLAUDE.md and Master Plan v4.0*
