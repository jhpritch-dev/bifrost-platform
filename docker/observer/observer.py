# observer.py -- BIFROST Signal Collector
# Version: 4.0 (aligned with MASTER-PLAN v2.9)
#
# Polls all inference endpoints and infrastructure, produces a signal
# snapshot every POLL_INTERVAL seconds. Consumed by the Broadcaster.
#
# Deployment: Hearth k3d cluster (namespace: inference-platform, port 8081)
# Dependencies: fastapi, uvicorn, httpx
#
# Signals (12 total):
#   1.  bifrost_ollama_live       -- Bifrost:11434 HTTP health + model inventory
#   2.  hearth_k3d_healthy        -- k3d node status via API server
#   3.  hearth_embed_live         -- Hearth:11435 embedding model loaded (CPU k3d pod)
#   4.  hearth_ollama_live        -- Hearth:11434 5700 XT inference health + model inventory
#   5.  hearth_vega8_live         -- Hearth:11436 Vega 8 iGPU Ollama health
#   6.  hearth_vega8_models       -- Hearth:11436 Vega 8 model loaded check (qwen3.5:4b)
#   7.  forge_lan_reachable       -- Forge:11434 over LAN
#   8.  forge_model_loaded        -- Forge /api/ps model list
#   9.  forge_gpu_offload         -- Forge /api/ps VRAM allocation
#  10.  forge_tailscale_reachable -- Forge via Tailscale tunnel
#  11.  forge_npu_available       -- Forge XDNA 2 NPU probe (stub until Phase 3)
#  12.  api_available             -- api.anthropic.com reachability

import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from enum import Enum
from typing import Optional

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration -- all overridable via environment variables
# ---------------------------------------------------------------------------

POLL_INTERVAL   = int(os.getenv("OBSERVER_POLL_INTERVAL", "30"))
PROBE_TIMEOUT   = float(os.getenv("OBSERVER_PROBE_TIMEOUT", "5"))

# Bifrost
BIFROST_OLLAMA_URL  = os.getenv("BIFROST_OLLAMA_URL",  "http://192.168.2.33:11434")
BIFROST_CPU_URL     = os.getenv("BIFROST_CPU_URL",     "http://192.168.2.33:11435")

# Hearth
HEARTH_EMBED_URL    = os.getenv("HEARTH_EMBED_URL",    "http://localhost:11435")
HEARTH_OLLAMA_URL   = os.getenv("HEARTH_OLLAMA_URL",   "http://192.168.2.4:11434")
HEARTH_VEGA8_URL    = os.getenv("HEARTH_VEGA8_URL",    "http://192.168.2.4:11436")
HEARTH_K3D_API_URL  = os.getenv("HEARTH_K3D_API_URL",  "https://localhost:6443")

# Forge
FORGE_OLLAMA_URL        = os.getenv("FORGE_OLLAMA_URL",        "")  # http://192.168.2.50:11434
FORGE_TAILSCALE_URL     = os.getenv("FORGE_TAILSCALE_URL",     "")  # http://100.x.x.x:11434
FORGE_NPU_PROBE_URL     = os.getenv("FORGE_NPU_PROBE_URL",     "")  # Phase 3 -- ONNX Runtime health

# Cloud
ANTHROPIC_API_URL   = os.getenv("ANTHROPIC_API_URL",   "https://api.anthropic.com")

# Vega 8 expected model -- flip TRUE only when this model is confirmed loaded
HEARTH_VEGA8_EXPECTED_MODEL = os.getenv("HEARTH_VEGA8_EXPECTED_MODEL", "qwen3.5:4b")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("observer")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class SignalValue(str, Enum):
    TRUE    = "TRUE"
    FALSE   = "FALSE"
    UNKNOWN = "UNKNOWN"


class SignalState(BaseModel):
    value:        SignalValue       = SignalValue.UNKNOWN
    detail:       Optional[str]     = None
    latency_ms:   Optional[float]   = None
    last_checked: Optional[float]   = None


class SignalSnapshot(BaseModel):
    """Complete signal state -- published every poll cycle."""
    # Bifrost
    bifrost_ollama_live:        SignalState = SignalState()
    # Hearth
    hearth_k3d_healthy:         SignalState = SignalState()
    hearth_embed_live:          SignalState = SignalState()
    hearth_ollama_live:         SignalState = SignalState()
    hearth_vega8_live:          SignalState = SignalState()
    hearth_vega8_models:        SignalState = SignalState()
    # Forge
    forge_lan_reachable:        SignalState = SignalState()
    forge_model_loaded:         SignalState = SignalState()
    forge_gpu_offload:          SignalState = SignalState()
    forge_tailscale_reachable:  SignalState = SignalState()
    forge_npu_available:        SignalState = SignalState()
    # Cloud
    api_available:              SignalState = SignalState()

    # Enriched data
    bifrost_loaded_models:      list[str]       = []
    hearth_loaded_models:       list[str]       = []
    hearth_vega8_loaded_models: list[str]       = []
    forge_loaded_models:        list[str]       = []
    forge_vram_used_bytes:      Optional[int]   = None
    forge_vram_total_bytes:     Optional[int]   = None

    # Metadata
    cycle_count: int    = 0
    timestamp:   float  = 0.0


class ObserverStore(BaseModel):
    snapshot:    SignalSnapshot     = SignalSnapshot()
    cycle_count: int                = 0
    last_cycle:  Optional[float]    = None


# ---------------------------------------------------------------------------
# Singleton store
# ---------------------------------------------------------------------------

store = ObserverStore()


# ---------------------------------------------------------------------------
# Probe helpers
# ---------------------------------------------------------------------------

def _now() -> float:
    return time.time()


def _ms(start: float) -> float:
    return round((time.monotonic() - start) * 1000, 1)


# ---------------------------------------------------------------------------
# Probe functions
# ---------------------------------------------------------------------------

async def probe_bifrost_ollama(client: httpx.AsyncClient) -> SignalState:
    """Signal 1: Bifrost Ollama health + model inventory."""
    try:
        t = time.monotonic()
        resp = await client.get(f"{BIFROST_OLLAMA_URL}/api/tags")
        ms = _ms(t)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            store.snapshot.bifrost_loaded_models = models
            return SignalState(value=SignalValue.TRUE,
                               detail=f"{len(models)} models available",
                               latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_hearth_k3d(client: httpx.AsyncClient) -> SignalState:
    """Signal 2: k3d cluster health via API server."""
    try:
        t = time.monotonic()
        async with httpx.AsyncClient(timeout=PROBE_TIMEOUT, verify=False) as k:
            resp = await k.get(f"{HEARTH_K3D_API_URL}/readyz")
        ms = _ms(t)
        ok = resp.status_code == 200
        return SignalState(value=SignalValue.TRUE if ok else SignalValue.FALSE,
                           detail="cluster ready" if ok else f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_hearth_embed(client: httpx.AsyncClient) -> SignalState:
    """Signal 3: Hearth CPU embed pod (k3d :11435) -- model loaded check."""
    try:
        t = time.monotonic()
        resp = await client.get(f"{HEARTH_EMBED_URL}/api/tags")
        ms = _ms(t)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            has_embed = any("embed" in m.lower() or "nomic" in m.lower() for m in models)
            return SignalState(
                value=SignalValue.TRUE if has_embed else SignalValue.FALSE,
                detail=f"embed model {'loaded' if has_embed else 'NOT loaded'}: {models}",
                latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_hearth_ollama(client: httpx.AsyncClient) -> SignalState:
    """Signal 4: Hearth 5700 XT Ollama (:11434) health + model inventory."""
    try:
        t = time.monotonic()
        resp = await client.get(f"{HEARTH_OLLAMA_URL}/api/tags")
        ms = _ms(t)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            store.snapshot.hearth_loaded_models = models
            return SignalState(value=SignalValue.TRUE,
                               detail=f"{len(models)} models available",
                               latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_hearth_vega8_live(client: httpx.AsyncClient) -> SignalState:
    """Signal 5: Hearth Vega 8 Ollama (:11436) reachability."""
    try:
        t = time.monotonic()
        resp = await client.get(f"{HEARTH_VEGA8_URL}/api/tags")
        ms = _ms(t)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            store.snapshot.hearth_vega8_loaded_models = models
            return SignalState(value=SignalValue.TRUE,
                               detail=f"Vega 8 live, {len(models)} models available",
                               latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_hearth_vega8_models(client: httpx.AsyncClient) -> SignalState:
    """Signal 6: Hearth Vega 8 -- expected model loaded check via /api/ps."""
    try:
        t = time.monotonic()
        resp = await client.get(f"{HEARTH_VEGA8_URL}/api/ps")
        ms = _ms(t)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            # Check for expected model (prefix match to handle :latest vs explicit tag)
            expected = HEARTH_VEGA8_EXPECTED_MODEL.split(":")[0]
            loaded = any(expected in m for m in models)
            return SignalState(
                value=SignalValue.TRUE if loaded else SignalValue.FALSE,
                detail=(
                    f"{HEARTH_VEGA8_EXPECTED_MODEL} loaded"
                    if loaded
                    else f"{HEARTH_VEGA8_EXPECTED_MODEL} NOT loaded (running: {models or 'none'})"
                ),
                latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_forge_lan(client: httpx.AsyncClient) -> SignalState:
    """Signal 7: Forge Ollama reachable over LAN."""
    if not FORGE_OLLAMA_URL:
        return SignalState(value=SignalValue.FALSE,
                           detail="FORGE_OLLAMA_URL not configured",
                           last_checked=_now())
    try:
        t = time.monotonic()
        resp = await client.get(f"{FORGE_OLLAMA_URL}/api/tags")
        ms = _ms(t)
        ok = resp.status_code == 200
        return SignalState(value=SignalValue.TRUE if ok else SignalValue.FALSE,
                           detail="Forge LAN reachable" if ok else f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_forge_models(client: httpx.AsyncClient) -> SignalState:
    """Signal 8: Forge loaded models via /api/ps."""
    if not FORGE_OLLAMA_URL:
        return SignalState(value=SignalValue.FALSE,
                           detail="FORGE_OLLAMA_URL not configured",
                           last_checked=_now())
    try:
        t = time.monotonic()
        resp = await client.get(f"{FORGE_OLLAMA_URL}/api/ps")
        ms = _ms(t)
        if resp.status_code == 200:
            models = [m["name"] for m in resp.json().get("models", [])]
            store.snapshot.forge_loaded_models = models
            return SignalState(
                value=SignalValue.TRUE if models else SignalValue.FALSE,
                detail=f"{len(models)} models loaded: {models}" if models else "no models loaded",
                latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_forge_gpu(client: httpx.AsyncClient) -> SignalState:
    """Signal 9: Forge GPU offload / VRAM allocation via /api/ps."""
    if not FORGE_OLLAMA_URL:
        return SignalState(value=SignalValue.FALSE,
                           detail="FORGE_OLLAMA_URL not configured",
                           last_checked=_now())
    try:
        t = time.monotonic()
        resp = await client.get(f"{FORGE_OLLAMA_URL}/api/ps")
        ms = _ms(t)
        if resp.status_code == 200:
            total_vram = sum(m.get("size_vram", 0) for m in resp.json().get("models", []))
            store.snapshot.forge_vram_used_bytes = total_vram
            gb = round(total_vram / (1024 ** 3), 1)
            return SignalState(
                value=SignalValue.TRUE if total_vram > 0 else SignalValue.FALSE,
                detail=f"{gb}GB VRAM in use",
                latency_ms=ms, last_checked=_now())
        return SignalState(value=SignalValue.FALSE,
                           detail=f"HTTP {resp.status_code}",
                           latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_forge_tailscale(client: httpx.AsyncClient) -> SignalState:
    """Signal 10: Forge reachable via Tailscale tunnel."""
    if not FORGE_TAILSCALE_URL:
        return SignalState(value=SignalValue.FALSE,
                           detail="FORGE_TAILSCALE_URL not configured",
                           last_checked=_now())
    try:
        t = time.monotonic()
        resp = await client.get(f"{FORGE_TAILSCALE_URL}/api/tags")
        ms = _ms(t)
        ok = resp.status_code == 200
        return SignalState(
            value=SignalValue.TRUE if ok else SignalValue.FALSE,
            detail=f"Tailscale {'reachable' if ok else 'unreachable'} ({ms}ms)",
            latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_forge_npu(client: httpx.AsyncClient) -> SignalState:
    """Signal 11: Forge XDNA 2 NPU -- stub until Phase 3 ONNX Runtime deployment."""
    if not FORGE_NPU_PROBE_URL:
        return SignalState(value=SignalValue.FALSE,
                           detail="FORGE_NPU_PROBE_URL not configured (Phase 3)",
                           last_checked=_now())
    try:
        t = time.monotonic()
        resp = await client.get(f"{FORGE_NPU_PROBE_URL}/health")
        ms = _ms(t)
        ok = resp.status_code == 200
        return SignalState(
            value=SignalValue.TRUE if ok else SignalValue.FALSE,
            detail=f"NPU {'online' if ok else 'offline'}",
            latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


async def probe_anthropic_api(client: httpx.AsyncClient) -> SignalState:
    """Signal 12: Anthropic API reachability (connectivity only, not auth)."""
    try:
        t = time.monotonic()
        resp = await client.get(
            f"{ANTHROPIC_API_URL}/v1/messages",
            headers={"x-api-key": "probe-only", "anthropic-version": "2023-06-01"},
        )
        ms = _ms(t)
        reachable = resp.status_code < 500
        return SignalState(
            value=SignalValue.TRUE if reachable else SignalValue.FALSE,
            detail=f"HTTP {resp.status_code} ({ms}ms)",
            latency_ms=ms, last_checked=_now())
    except Exception as e:
        return SignalState(value=SignalValue.FALSE,
                           detail=str(e)[:120], last_checked=_now())


# ---------------------------------------------------------------------------
# Poll cycle
# ---------------------------------------------------------------------------

# Ordered list must match gather() order below
_SIGNAL_NAMES = [
    "bifrost_ollama_live",
    "hearth_k3d_healthy",
    "hearth_embed_live",
    "hearth_ollama_live",
    "hearth_vega8_live",
    "hearth_vega8_models",
    "forge_lan_reachable",
    "forge_model_loaded",
    "forge_gpu_offload",
    "forge_tailscale_reachable",
    "forge_npu_available",
    "api_available",
]


async def poll_cycle(client: httpx.AsyncClient):
    """Execute all probes concurrently and update the snapshot."""
    results = await asyncio.gather(
        probe_bifrost_ollama(client),       # 1
        probe_hearth_k3d(client),           # 2
        probe_hearth_embed(client),         # 3
        probe_hearth_ollama(client),        # 4
        probe_hearth_vega8_live(client),    # 5
        probe_hearth_vega8_models(client),  # 6
        probe_forge_lan(client),            # 7
        probe_forge_models(client),         # 8
        probe_forge_gpu(client),            # 9
        probe_forge_tailscale(client),      # 10
        probe_forge_npu(client),            # 11
        probe_anthropic_api(client),        # 12
        return_exceptions=True,
    )

    for name, result in zip(_SIGNAL_NAMES, results):
        if isinstance(result, SignalState):
            setattr(store.snapshot, name, result)
        else:
            setattr(store.snapshot, name, SignalState(
                value=SignalValue.FALSE,
                detail=f"probe exception: {result}",
                last_checked=_now(),
            ))

    store.cycle_count += 1
    store.snapshot.cycle_count = store.cycle_count
    store.snapshot.timestamp   = _now()
    store.last_cycle           = _now()


async def poll_loop(client: httpx.AsyncClient):
    """Continuous polling loop -- never exits unless cancelled."""
    while True:
        try:
            await poll_cycle(client)
            s = store.snapshot
            v = SignalValue.TRUE
            logger.info(
                "Cycle %d: bifrost=%s hearth=%s vega8=%s forge=%s api=%s",
                store.cycle_count,
                "OK" if s.bifrost_ollama_live.value == v else "X",
                "OK" if s.hearth_ollama_live.value  == v else "X",
                "OK" if s.hearth_vega8_live.value   == v else "X",
                "OK" if s.forge_lan_reachable.value  == v else "X",
                "OK" if s.api_available.value        == v else "X",
            )
        except Exception as e:
            logger.error("Poll cycle error: %s", e)
        await asyncio.sleep(POLL_INTERVAL)


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    client = httpx.AsyncClient(timeout=PROBE_TIMEOUT)
    task = asyncio.create_task(poll_loop(client))
    logger.info(
        "Observer v4.0 started -- %d signals, polling every %ds, timeout %.1fs",
        len(_SIGNAL_NAMES), POLL_INTERVAL, PROBE_TIMEOUT,
    )
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await client.aclose()
    logger.info("Observer stopped")


app = FastAPI(
    title="BIFROST Observer",
    description="Signal collector -- polls all inference endpoints and infrastructure",
    version="4.0",
    lifespan=lifespan,
)


@app.get("/signals")
async def get_signals() -> SignalSnapshot:
    """Current signal snapshot -- consumed by Broadcaster."""
    return store.snapshot


@app.get("/signals/{signal_name}")
async def get_signal(signal_name: str) -> SignalState:
    """Individual signal lookup."""
    if hasattr(store.snapshot, signal_name):
        return getattr(store.snapshot, signal_name)
    return SignalState(value=SignalValue.UNKNOWN,
                       detail=f"unknown signal: {signal_name}")


@app.get("/health")
async def health():
    """Observer health -- reports polling freshness."""
    cycle_age = (
        round(_now() - store.last_cycle, 1) if store.last_cycle else None
    )
    stale = cycle_age is not None and cycle_age > (POLL_INTERVAL * 3)
    if store.cycle_count == 0:
        status = "starting"
    elif stale:
        status = "degraded"
    else:
        status = "healthy"
    return {
        "service":                "observer",
        "version":                "4.0",
        "status":                 status,
        "cycle_count":            store.cycle_count,
        "last_cycle_age_seconds": cycle_age,
        "poll_interval":          POLL_INTERVAL,
        "signals_total":          len(_SIGNAL_NAMES),
    }
