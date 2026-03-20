"""
telemetry.py -- BIFROST InferenceEvent schema + async SQLite writer
No prompt/completion content stored. Non-blocking writes via thread pool.
"""
import asyncio
import json
import logging
import sqlite3
import time
import uuid
from pathlib import Path
from pydantic import BaseModel, Field

MACHINE  = "bifrost"
HARDWARE = "bifrost-3950x-9070xt-rdna4"

# F:\ is the Hearth SMB share (bifrost-logs). Writes fail gracefully if unavailable.
TELEMETRY_DIR = Path(r"F:\bifrost-logs\telemetry")
TELEMETRY_DB  = TELEMETRY_DIR / "inference_events.db"

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS inference_events (
    event_id         TEXT PRIMARY KEY,
    timestamp        REAL,
    machine          TEXT,
    hardware         TEXT,
    strategy         TEXT,
    complexity_band  TEXT,
    tier_used        TEXT,
    tier_history     TEXT,
    escalation_count INTEGER,
    model            TEXT,
    tokens_input     INTEGER,
    tokens_output    INTEGER,
    tokens_total     INTEGER,
    latency_ms       REAL,
    cloud_cost_usd   REAL,
    status           TEXT
)
"""


class InferenceEvent(BaseModel):
    event_id:         str   = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp:        float = Field(default_factory=time.time)
    machine:          str   = MACHINE
    hardware:         str   = HARDWARE
    strategy:         str   = "INTERACTIVE"
    complexity_band:  str   = ""
    tier_used:        str   = ""
    tier_history:     list  = Field(default_factory=list)
    escalation_count: int   = 0
    model:            str   = ""
    tokens_input:     int   = 0
    tokens_output:    int   = 0
    tokens_total:     int   = 0
    latency_ms:       float = 0.0
    cloud_cost_usd:   float = 0.0
    status:           str   = "PASS"  # PASS | FAILED_NEEDS_HUMAN | ERROR


def _ensure_db() -> sqlite3.Connection:
    TELEMETRY_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(TELEMETRY_DB))
    conn.execute(_CREATE_SQL)
    conn.commit()
    return conn


def write_event_sync(event: InferenceEvent) -> None:
    """Synchronous write -- called via thread pool, never blocks the event loop."""
    try:
        conn = _ensure_db()
        conn.execute(
            "INSERT OR IGNORE INTO inference_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                event.event_id, event.timestamp, event.machine, event.hardware,
                event.strategy, event.complexity_band, event.tier_used,
                json.dumps(event.tier_history), event.escalation_count,
                event.model, event.tokens_input, event.tokens_output,
                event.tokens_total, event.latency_ms, event.cloud_cost_usd,
                event.status,
            ),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        logging.warning("[telemetry] write failed: %s", exc)


async def write_event(event: InferenceEvent) -> None:
    """Async wrapper -- offloads SQLite write to thread pool."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, write_event_sync, event)


# ── Query helpers (used by FastAPI endpoints in main.py) ────────────────────

def query_recent(n: int = 20) -> list[dict]:
    try:
        conn = _ensure_db()
        cols = [d[0] for d in conn.execute("PRAGMA table_info(inference_events)").fetchall()]
        rows = conn.execute(
            "SELECT * FROM inference_events ORDER BY timestamp DESC LIMIT ?", (n,)
        ).fetchall()
        conn.close()
        return [dict(zip(cols, r)) for r in rows]
    except Exception as exc:
        logging.warning("[telemetry] query_recent failed: %s", exc)
        return []


def query_band_distribution() -> dict:
    try:
        conn = _ensure_db()
        rows = conn.execute(
            "SELECT complexity_band, COUNT(*) FROM inference_events GROUP BY complexity_band"
        ).fetchall()
        conn.close()
        return {r[0]: r[1] for r in rows}
    except Exception as exc:
        logging.warning("[telemetry] query_band_distribution failed: %s", exc)
        return {}


def query_cloud_spend() -> dict:
    try:
        conn = _ensure_db()
        total = conn.execute(
            "SELECT SUM(cloud_cost_usd) FROM inference_events"
        ).fetchone()[0] or 0.0
        by_tier = conn.execute(
            "SELECT tier_used, SUM(cloud_cost_usd) FROM inference_events GROUP BY tier_used"
        ).fetchall()
        conn.close()
        return {
            "total_usd": round(total, 6),
            "by_tier":   {r[0]: round(r[1], 6) for r in by_tier},
        }
    except Exception as exc:
        logging.warning("[telemetry] query_cloud_spend failed: %s", exc)
        return {"total_usd": 0.0, "by_tier": {}}
