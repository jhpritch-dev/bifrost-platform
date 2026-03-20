"""
BIFROST Complexity Router — Main Application
==============================================
FastAPI service on Bifrost:8080. Intercepts inference requests,
classifies complexity, routes to appropriate tier.

OpenAI-compatible API surface so Continue.dev (and any other
OpenAI-speaking client) works with a single config change:
    apiBase: "http://localhost:11434"  →  "http://localhost:8080"

Phase 0: Ollama direct (no router)
Phase 1: THIS — Router classifies and routes (WORKSHOP mode)
Phase 2: Full tier cascade with Forge
"""

import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

# Ensure project root is on sys.path (uvicorn subprocess may not inherit it)
_project_root = str(Path(__file__).parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from telemetry import query_recent, query_band_distribution, query_cloud_spend
from telemetry import InferenceEvent, write_event as _write_event
from classifier import classify, ClassificationResult
from config import (
    CASCADE_TABLES,
    ComplexityBand,
    DEFAULT_CASCADE_MODE,
    OperatingMode,
    RoutingStrategy,
    Tier,
    TIER_BACKENDS,
    settings,
)
from backends.ollama import ollama_chat_completion, ollama_completion
from backends.anthropic import anthropic_chat_completion
from backends.openai_compat import openai_compat_chat_completion
from strategies import two_pass_stream, select_local_tier
from autopilot_graph import run_autopilot
from review_prompts import get_review_provider
from commands import handle_command
from pr_review import (
    run_pr_review, post_pr_comment, fetch_pr_diff,
    verify_github_signature, GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET,
)
from metrics import metrics, MetricsCollector, RoutingEvent


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("bifrost.router")


# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load API keys from environment if not in settings
    if not settings.anthropic_api_key:
        settings.anthropic_api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not settings.gemini_api_key:
        settings.gemini_api_key = os.environ.get("GEMINI_API_KEY")
    if not settings.groq_api_key:
        settings.groq_api_key = os.environ.get("GROQ_API_KEY")

    cloud_status = []
    if settings.gemini_api_key:
        cloud_status.append("Gemini ✓")
    if settings.groq_api_key:
        cloud_status.append("Groq ✓")
    if settings.anthropic_api_key:
        cloud_status.append("Claude ✓")
    cloud_str = ", ".join(cloud_status) if cloud_status else "NONE"

    log.info("=" * 60)
    log.info("BIFROST Complexity Router starting")
    log.info(f"  Mode:    {settings.current_mode.value}")
    log.info(f"  Profile: {settings.bifrost_profile.value}")
    log.info(f"  Ollama:  {settings.ollama_base_url}")
    log.info(f"  Cloud:   {cloud_str}")
    log.info(f"  Listen:  {settings.host}:{settings.port}")
    log.info("=" * 60)

    # Quick health check on Ollama
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.ollama_base_url}/api/tags")
            models = [m["name"] for m in resp.json().get("models", [])]
            log.info(f"  Ollama models available: {models}")
    except Exception as e:
        log.warning(f"  Ollama not reachable: {e}")

    # Poll Arbiter for current mode on startup (fixes gauge showing WORKSHOP after restart)
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.arbiter_url}/mode")
            arbiter_data = resp.json()
            confirmed = arbiter_data.get("confirmed_mode", "")
            if confirmed and confirmed not in ("DEGRADED", ""):
                try:
                    settings.current_mode = OperatingMode(confirmed)
                    log.info(f"  Mode from Arbiter: {confirmed}")
                except ValueError:
                    log.warning(f"  Unknown Arbiter mode '{confirmed}', keeping default")
    except Exception as _e:
        log.warning(f"  Arbiter not reachable on startup ({_e}), keeping default mode")

    # Initialize Prometheus gauges
    metrics.set_mode(settings.current_mode.value)
    metrics.set_info(
        mode=settings.current_mode.value,
        profile=settings.bifrost_profile.value,
    )
    log.info(f"  Prometheus: /metrics endpoint active")

    # Persistent httpx client for slash commands (Arbiter calls, etc.)
    app.state.http_client = httpx.AsyncClient()

    yield

    await app.state.http_client.aclose()
    log.info("BIFROST Router shutting down")


app = FastAPI(
    title="BIFROST Complexity Router",
    version="1.0.0",
    description="Distributed AI inference routing — local-first, privacy-first",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Bifrost-Tier","X-Bifrost-Band","X-Bifrost-Mode","X-Bifrost-Strategy"],
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_cascade(band: ComplexityBand) -> list[Tier]:
    """Get the tier cascade for a complexity band in the current mode."""
    mode = settings.current_mode
    table = CASCADE_TABLES.get(mode, CASCADE_TABLES.get(DEFAULT_CASCADE_MODE, {}))
    return table.get(band, [])


async def dispatch_to_tier(
    tier: Tier,
    messages: list[dict],
    stream: bool,
    temperature: float,
    max_tokens: int | None,
) -> dict | AsyncIterator[str]:
    """Dispatch a request to a specific tier's backend."""
    backend = TIER_BACKENDS[tier]
    backend_type = backend["type"]

    if backend_type == "ollama":
        return await ollama_chat_completion(
            messages=messages,
            tier=tier,
            stream=stream,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    elif backend_type == "anthropic":
        return await anthropic_chat_completion(
            messages=messages,
            stream=stream,
            temperature=temperature,
            max_tokens=max_tokens or 4096,
        )
    elif backend_type == "openai_compat":
        return await openai_compat_chat_completion(
            messages=messages,
            provider=backend["provider"],
            model=backend.get("model"),
            stream=stream,
            temperature=temperature,
            max_tokens=max_tokens or 4096,
        )
    else:
        raise ValueError(f"Unsupported backend type: {backend_type}")


def extract_user_prompt(messages: list[dict]) -> str:
    """Extract the last user message for classification."""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            return msg.get("content", "")
    return ""


def add_routing_headers(response: Response, band: ComplexityBand, tier: Tier, classification: ClassificationResult):
    """Add X-Bifrost-* headers to response."""
    response.headers["X-Bifrost-Band"] = band.value
    response.headers["X-Bifrost-Tier"] = tier.value
    response.headers["X-Bifrost-Mode"] = settings.current_mode.value
    response.headers["X-Bifrost-Confidence"] = str(round(classification.confidence, 2))


# ---------------------------------------------------------------------------
# Static analysis post-processing (Block 1 hardening)
# ---------------------------------------------------------------------------

def _extract_python_blocks(text: str) -> list[str]:
    """Extract fenced Python code blocks from a markdown response."""
    return re.findall(r"```(?:python|py)?\n(.*?)```", text, re.DOTALL)


def _run_ruff(code: str) -> list[str]:
    tmp = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".py", delete=False, encoding="utf-8"
        ) as f:
            f.write(code)
            tmp = f.name
        result = subprocess.run(
            ["ruff", "check", "--select=E,F,W", "--output-format=text", tmp],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            return []
        lines = [l.replace(tmp, "<code>") for l in result.stdout.splitlines() if l.strip()]
        return lines[:10]
    except Exception:
        return []
    finally:
        if tmp:
            Path(tmp).unlink(missing_ok=True)


async def _static_analysis_recheck(
    messages: list[dict],
    response_text: str,
    tier,
    temperature: float,
    max_tokens: int | None,
) -> str:
    blocks = _extract_python_blocks(response_text)
    if not blocks:
        return response_text

    all_errors: list[str] = []
    for block in blocks:
        all_errors.extend(_run_ruff(block))

    if not all_errors:
        return response_text

    log.info(f"STATIC_ANALYSIS: {len(all_errors)} ruff issue(s) — re-prompting tier={tier.value}")
    error_summary = "\n".join(all_errors)

    fix_messages = messages + [
        {"role": "assistant", "content": response_text},
        {"role": "user", "content": (
            f"The code above has linting issues. Please fix them and return the corrected code:\n\n{error_summary}"
        )},
    ]
    try:
        fixed = await dispatch_to_tier(
            tier=tier,
            messages=fix_messages,
            stream=False,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return fixed["choices"][0]["message"]["content"]
    except Exception as _e:
        log.warning(f"STATIC_ANALYSIS: re-prompt failed ({_e}), returning original")
        return response_text


# ---------------------------------------------------------------------------
# OpenAI-compatible endpoints
# ---------------------------------------------------------------------------

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    temperature = body.get("temperature", 0.7)
    max_tokens = body.get("max_tokens")
    model_hint = body.get("model", "")

    # --- Slash command interception ---
    user_prompt = extract_user_prompt(messages)
    user_prompt_stripped = user_prompt.strip()
    if user_prompt_stripped.startswith("/") or user_prompt_stripped.startswith("BIFROST_AUTOPILOT:"):
        user_prompt = user_prompt_stripped
    if user_prompt.startswith("/"):
        cmd_result = await handle_command(
            user_prompt,
            settings,
            metrics,
            app.state.http_client,
        )
        if cmd_result is not None:
            log.info(f"COMMAND: {user_prompt.split()[0]}")
            return JSONResponse({
                "id": f"cmd-{int(time.time())}",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": "bifrost-system",
                "choices": [{
                    "index": 0,
                    "message": {"role": "assistant", "content": cmd_result},
                    "finish_reason": "stop",
                }],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            })

    hint = request.headers.get("X-Complexity-Hint")
    file_count = int(request.headers.get("X-File-Count", "0"))

    # -- AUTOPILOT strategy ------------------------------------------------
    if (request.headers.get("X-Strategy", "").lower() == "autopilot" or body.get("strategy", "").upper() == "AUTOPILOT" or settings.default_strategy.value == "AUTOPILOT"):
        import os as _os, uuid as _uuid, time as _time
        from autopilot_graph import run_autopilot as _run
        if not settings.anthropic_api_key:
            settings.anthropic_api_key = _os.environ.get("ANTHROPIC_API_KEY")
        _gid = str(_uuid.uuid4())
        _ap_t_start = _time.time()
        try:
            _r = _run(prompt=user_prompt, messages=messages, graph_id=_gid)
            _ap_latency_ms = (_time.time() - _ap_t_start) * 1000
            _ap_success = _r.get("status") in ("COMPLETE",)
            metrics.record(RoutingEvent(
                timestamp=_time.time(),
                band=ComplexityBand.COMPLEX,
                tier=Tier.T2_5,
                latency_ms=_ap_latency_ms,
                success=_ap_success,
            ))
            _subtask_count = len(_r.get("completed", {})) + len(_r.get("failed", {}))
            return JSONResponse({
                "id": f"chatcmpl-ap-{_gid[:8]}",
                "object": "chat.completion",
                "created": int(_time.time()),
                "model": "bifrost-autopilot",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": _r.get("assembled_output") or ""}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                "bifrost": {"strategy": "AUTOPILOT", "graph_id": _gid, "status": _r.get("status"), "subtasks": _subtask_count, "completed": len(_r.get("completed", {})), "failed": len(_r.get("failed", {})), "cloud_cost_usd": _r.get("cloud_cost_usd", 0.0)},
            })
        except Exception as _e:
            metrics.record(RoutingEvent(
                timestamp=_time.time(),
                band=ComplexityBand.COMPLEX,
                tier=Tier.T2_5,
                latency_ms=(_time.time() - _ap_t_start) * 1000,
                success=False,
            ))
            return JSONResponse({"error": str(_e)[:300]}, status_code=500)

    # Classify
    classification = classify(prompt=user_prompt, file_count=file_count, hint=hint)
    band = classification.band
    cascade = get_cascade(band)

    if settings.log_routing_decisions:
        log.info(
            f"ROUTE: band={band.value} confidence={classification.confidence:.2f} "
            f"cascade={[t.value for t in cascade]} "
            f"reason='{classification.reasoning}'"
        )

    if not cascade:
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": (
                        f"No tiers available for {band.value} in {settings.current_mode.value} mode. "
                        f"Task requires human intervention or mode upgrade."
                    ),
                    "type": "bifrost_routing_error",
                    "code": "FAILED_NEEDS_HUMAN",
                    "band": band.value,
                    "mode": settings.current_mode.value,
                }
            },
        )

    # --- Strategy branching ---
    strategy = settings.default_strategy
    min_band_for_two_pass = ComplexityBand(settings.two_pass_min_band)
    band_order = [ComplexityBand.TRIVIAL, ComplexityBand.MODERATE, ComplexityBand.COMPLEX, ComplexityBand.FRONTIER]

    use_two_pass = (
        strategy == RoutingStrategy.TWO_PASS
        and band_order.index(band) >= band_order.index(min_band_for_two_pass)
    )

    if use_two_pass:
        local_tier = select_local_tier(band)
        review_provider = get_review_provider(band)
        log.info(
            f"TWO_PASS: band={band.value} draft={local_tier.value} "
            f"review={review_provider}"
        )
        t_start = time.time()

        async def two_pass_with_metrics():
            async for chunk in two_pass_stream(
                messages=messages,
                band=band,
                local_tier=local_tier,
                temperature=temperature,
                max_tokens=max_tokens,
            ):
                yield chunk
            total_ms = (time.time() - t_start) * 1000
            metrics.record(RoutingEvent(
                timestamp=time.time(),
                band=band,
                tier=local_tier,
                latency_ms=total_ms,
                success=True,
            ))

        return StreamingResponse(
            two_pass_with_metrics(),
            media_type="text/event-stream",
            headers={
                "X-Bifrost-Band": band.value,
                "X-Bifrost-Tier": f"{local_tier.value}+{review_provider}",
                "X-Bifrost-Mode": settings.current_mode.value,
                "X-Bifrost-Strategy": "TWO_PASS",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    # --- INTERACTIVE strategy ---
    last_error = None
    for tier in cascade:
        t_start = time.time()
        try:
            result = await dispatch_to_tier(
                tier=tier,
                messages=messages,
                stream=stream,
                temperature=temperature,
                max_tokens=max_tokens,
            )

            latency_ms = (time.time() - t_start) * 1000
            escalated = tier != cascade[0]

            if stream:
                async def stream_with_headers():
                    first_token_time = None
                    async for chunk in result:
                        if first_token_time is None:
                            first_token_time = time.time()
                        yield chunk
                    total_ms = (time.time() - t_start) * 1000
                    ttft_ms = ((first_token_time - t_start) * 1000) if first_token_time else 0
                    metrics.record(RoutingEvent(
                        timestamp=time.time(),
                        band=band,
                        tier=tier,
                        latency_ms=ttft_ms,
                        success=True,
                        escalated=escalated,
                        escalation_from=cascade[0] if escalated else None,
                    ))
                    log.info(
                        f"COMPLETE: tier={tier.value} ttft={ttft_ms:.0f}ms total={total_ms:.0f}ms"
                    )

                return StreamingResponse(
                    stream_with_headers(),
                    media_type="text/event-stream",
                    headers={
                        "X-Bifrost-Band": band.value,
                        "X-Bifrost-Tier": tier.value,
                        "X-Bifrost-Mode": settings.current_mode.value,
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                    },
                )
            else:
                # Non-streaming — emit telemetry event
                import asyncio as _asyncio
                _asyncio.create_task(_write_event(InferenceEvent(
                    strategy="INTERACTIVE",
                    complexity_band=band.value,
                    tier_used=tier.value,
                    tier_history=[t.value for t in cascade[:cascade.index(tier)+1]],
                    escalation_count=cascade.index(tier),
                    model=TIER_BACKENDS[tier].get("model", tier.value),
                    tokens_total=result.get("usage", {}).get("total_tokens", 0),
                    latency_ms=latency_ms,
                    cloud_cost_usd=0.0,
                    status="PASS",
                )))
                metrics.record(RoutingEvent(
                    timestamp=time.time(),
                    band=band,
                    tier=tier,
                    latency_ms=latency_ms,
                    success=True,
                    escalated=escalated,
                    escalation_from=cascade[0] if escalated else None,
                ))
                # Strip fences for T1A tiers
                if tier.value in {"1a-coder", "1a-hearth", "1a-overflow", "1a-instruct"}:
                    try:
                        _txt = result["choices"][0]["message"]["content"]
                        _txt = _txt.strip()
                        _txt = re.sub(r"^```[a-zA-Z]*\r?\n", "", _txt)
                        _txt = re.sub(r"\r?\n```$", "", _txt)
                        result["choices"][0]["message"]["content"] = _txt.strip()
                    except (KeyError, IndexError):
                        pass
                response = JSONResponse(content=result)
                add_routing_headers(response, band, tier, classification)
                return response

        except Exception as e:
            last_error = e
            latency_ms = (time.time() - t_start) * 1000
            log.warning(
                f"ESCALATE: tier={tier.value} failed ({type(e).__name__}: {e}), "
                f"trying next in cascade"
            )
            metrics.record(RoutingEvent(
                timestamp=time.time(),
                band=band,
                tier=tier,
                latency_ms=latency_ms,
                success=False,
                escalated=True,
            ))
            continue

    log.error(f"FAILED: All tiers exhausted for band={band.value}. Last error: {last_error}")
    return JSONResponse(
        status_code=502,
        content={
            "error": {
                "message": f"All tiers failed for {band.value}. Last error: {str(last_error)}",
                "type": "bifrost_cascade_exhausted",
                "code": "CASCADE_EXHAUSTED",
                "band": band.value,
                "tiers_tried": [t.value for t in cascade],
            }
        },
    )


@app.post("/v1/completions")
async def completions(request: Request):
    body = await request.json()
    prompt = body.get("prompt", "")
    stream = body.get("stream", False)
    temperature = body.get("temperature", 0.2)
    max_tokens = body.get("max_tokens", 256)

    tier = Tier.T1A_CODER
    band = ComplexityBand.TRIVIAL

    t_start = time.time()
    try:
        result = await ollama_completion(
            prompt=prompt,
            tier=tier,
            stream=stream,
            temperature=temperature,
            max_tokens=max_tokens,
        )

        latency_ms = (time.time() - t_start) * 1000
        metrics.record(RoutingEvent(
            timestamp=time.time(),
            band=band,
            tier=tier,
            latency_ms=latency_ms,
            success=True,
        ))

        if stream:
            return StreamingResponse(
                result,
                media_type="text/event-stream",
                headers={
                    "X-Bifrost-Band": "TRIVIAL",
                    "X-Bifrost-Tier": "1a-coder",
                    "Cache-Control": "no-cache",
                },
            )
        else:
            response = JSONResponse(content=result)
            response.headers["X-Bifrost-Band"] = "TRIVIAL"
            response.headers["X-Bifrost-Tier"] = "1a-coder"
            return response

    except Exception as e:
        log.error(f"Autocomplete failed: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": {"message": str(e), "type": "bifrost_error"}},
        )


# ---------------------------------------------------------------------------
# Model listing
# ---------------------------------------------------------------------------

@app.get("/v1/models")
async def list_models():
    mode = settings.current_mode.value
    models = [
        {"id": "bifrost-auto", "object": "model", "owned_by": "bifrost", "description": f"Auto-routed by complexity ({mode} mode)"},
        {"id": "bifrost-coder", "object": "model", "owned_by": "bifrost", "description": "Direct to Tier 1a-coder (qwen2.5-coder:7b)"},
        {"id": "bifrost-cloud", "object": "model", "owned_by": "bifrost", "description": "Direct to Tier 3-Claude"},
    ]
    return {"object": "list", "data": models}


# ---------------------------------------------------------------------------
# BIFROST-specific endpoints
# ---------------------------------------------------------------------------

@app.get("/status")
async def status():
    return {
        "router": "online",
        "mode": settings.current_mode.value,
        "profile": settings.bifrost_profile.value,
        "strategy": settings.default_strategy.value,
        "cloud_configured": {
            "groq": bool(settings.groq_api_key),
            "gemini": bool(settings.gemini_api_key),
            "anthropic": bool(settings.anthropic_api_key),
        },
        "two_pass": {
            "active_reviewers": {
                "MODERATE": get_review_provider(ComplexityBand.MODERATE),
                "COMPLEX": get_review_provider(ComplexityBand.COMPLEX),
                "FRONTIER": get_review_provider(ComplexityBand.FRONTIER),
            },
            "min_band": settings.two_pass_min_band,
            "local_timeout": settings.two_pass_local_timeout,
        },
        "metrics": metrics.summary(),
    }


@app.post("/strategy")
async def set_strategy(request: Request):
    body = await request.json()
    strategy_str = body.get("strategy", "").upper()
    try:
        new_strategy = RoutingStrategy(strategy_str)
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid strategy: {strategy_str}. Use: {', '.join(s.value for s in RoutingStrategy)}"},
        )
    old = settings.default_strategy
    settings.default_strategy = new_strategy
    log.info(f"STRATEGY: {old.value} -> {new_strategy.value}")
    return {
        "strategy": new_strategy.value,
        "previous": old.value,
        "two_pass_config": {
            "active_reviewers": {
                "MODERATE": get_review_provider(ComplexityBand.MODERATE),
                "COMPLEX": get_review_provider(ComplexityBand.COMPLEX),
                "FRONTIER": get_review_provider(ComplexityBand.FRONTIER),
            },
            "min_band": settings.two_pass_min_band,
        },
    }


@app.get("/metrics")
async def prometheus_metrics():
    body, content_type = metrics.prometheus_export()
    return Response(content=body, media_type=content_type)


@app.get("/metrics/summary")
async def metrics_summary():
    return metrics.summary()


@app.get("/metrics/recent")
async def metrics_recent(n: int = 20):
    return metrics.recent(n)


@app.get("/cascade/{band}")
async def show_cascade(band: str):
    try:
        b = ComplexityBand(band.upper())
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid band: {band}. Use TRIVIAL/MODERATE/COMPLEX/FRONTIER"},
        )
    cascade = get_cascade(b)
    return {
        "band": b.value,
        "mode": settings.current_mode.value,
        "cascade": [t.value for t in cascade],
        "backends": [{"tier": t.value, **TIER_BACKENDS[t]} for t in cascade],
    }


@app.get("/telemetry/recent")
async def telemetry_recent(n: int = 20):
    return {"events": query_recent(n)}

@app.get("/telemetry/bands")
async def telemetry_bands():
    return query_band_distribution()

@app.get("/telemetry/cloud-spend")
async def telemetry_cloud_spend():
    return query_cloud_spend()


@app.post("/classify")
async def classify_request(request: Request):
    body = await request.json()
    prompt = body.get("prompt", "")
    hint = body.get("hint")
    file_count = body.get("file_count", 0)
    result = classify(prompt=prompt, file_count=file_count, hint=hint)
    cascade = get_cascade(result.band)
    return {
        "band": result.band.value,
        "confidence": round(result.confidence, 3),
        "reasoning": result.reasoning,
        "scores": result.scores,
        "cascade": [t.value for t in cascade],
        "mode": settings.current_mode.value,
    }


@app.post("/mode")
async def set_mode(request: Request):
    body = await request.json()
    mode_str = body.get("mode", "").upper()
    try:
        new_mode = OperatingMode(mode_str)
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": f"Invalid mode: {mode_str}. Valid: {[m.value for m in OperatingMode]}"},
        )
    old_mode = settings.current_mode
    settings.current_mode = new_mode
    log.info(f"MODE CHANGE: {old_mode.value} → {new_mode.value}")
    return {
        "previous": old_mode.value,
        "current": new_mode.value,
        "cascade_tables": {
            band.value: [t.value for t in get_cascade(band)]
            for band in ComplexityBand
        },
    }


# ---------------------------------------------------------------------------
# GitHub PR Review Webhook
# ---------------------------------------------------------------------------

@app.post("/webhook/github")
async def github_webhook(request: Request):
    import asyncio as _asyncio

    payload_bytes = await request.body()
    sig_header    = request.headers.get("X-Hub-Signature-256", "")

    if not verify_github_signature(payload_bytes, sig_header):
        log.warning("GitHub webhook: invalid signature — rejecting")
        return JSONResponse(status_code=401, content={"error": "invalid signature"})

    try:
        payload = json.loads(payload_bytes)
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON"})

    action = payload.get("action", "")
    if action not in ("opened", "synchronize", "reopened"):
        log.info(f"GitHub webhook: ignoring action '{action}'")
        return JSONResponse({"status": "ignored", "action": action})

    pr       = payload.get("pull_request", {})
    pr_num   = pr.get("number")
    pr_title = pr.get("title", "")
    pr_body  = pr.get("body", "") or ""
    repo     = payload.get("repository", {}).get("full_name", "")

    if not pr_num or not repo:
        return JSONResponse(status_code=400, content={"error": "missing PR number or repo"})

    log.info(f"GitHub webhook: PR #{pr_num} '{pr_title}' in {repo} — starting review")

    async def _run_review():
        diff = fetch_pr_diff(repo, pr_num)
        if not diff:
            log.error(f"PR #{pr_num}: could not fetch diff")
            return
        result = run_pr_review(pr_title, pr_body, diff)
        posted = post_pr_comment(repo, pr_num, result["comment_body"])
        log.info(
            f"PR #{pr_num}: verdict={result['verdict']} "
            f"lines={result['diff_lines']} reviewers={len(result['results'])} "
            f"posted={posted}"
        )
        metrics.record(RoutingEvent(
            timestamp=time.time(),
            band=ComplexityBand.COMPLEX,
            tier=Tier.T1A_HEARTH,
            latency_ms=0,
            success=posted,
        ))

    _asyncio.create_task(_run_review())

    return JSONResponse({"status": "accepted", "pr": pr_num, "repo": repo, "action": action})


@app.get("/webhook/status")
async def webhook_status():
    return {
        "github_token_set":    bool(GITHUB_TOKEN),
        "webhook_secret_set":  bool(GITHUB_WEBHOOK_SECRET),
        "review_tiers":        ["1a-hearth", "1a-overflow"],
        "large_diff_tier":     "1b (Forge, >500 lines)",
        "large_diff_threshold": 500,
    }


@app.get("/health")
async def health():
    return {"status": "ok", "service": "bifrost-router"}


@app.get("/")
async def root():
    return {
        "service": "BIFROST Complexity Router",
        "version": "1.0.0",
        "mode": settings.current_mode.value,
        "docs": "/docs",
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=False,
        log_level="info",
    )
