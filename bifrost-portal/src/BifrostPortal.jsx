import { useState, useEffect, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  AreaChart, Area, Tooltip,
} from "recharts";

// ═══════════════════════════════════════════════════════════
// CONFIG — flip MOCK to false when deployed on Hearth :3100
// ═══════════════════════════════════════════════════════════
const BROADCASTER = "http://192.168.2.4:8092";
const ARBITER     = "http://192.168.2.33:8082";
const PROMETHEUS  = "http://192.168.2.4:3110/prom";
const POLL_MS     = 15_000;
const MOCK        = false;
const ROUTER      = "http://192.168.2.33:8080";
const KB          = "http://192.168.2.4:8091";
const KB_SUPPORTED = [".pdf", ".docx", ".md", ".txt"];

// ═══════════════════════════════════════════════════════════
// DESIGN TOKENS
// ═══════════════════════════════════════════════════════════
const BG    = "#080B11";
const SURF  = "#0F1319";
const ELEV  = "#151C29";
const BORD  = "#1C2538";
const BORDB = "#283050";
const TX    = "#D8E2F4";
const TXD   = "#68778E";
const TXM   = "#323C54";
const GRN   = "#3CB87A";
const BLU   = "#4E8ED4";
const AMB   = "#D09435";
const ORG   = "#C47035";
const RSE   = "#BC4868";
const PRP   = "#8658C8";

const BAND_C = { TRIVIAL: GRN, MODERATE: BLU, COMPLEX: ORG, FRONTIER: PRP };
const TIER_C = {
  "1a-hearth":   "#3DB87A",
  "1a-coder":    GRN,
  "1a-instruct": "#4CB890",
  "1b":          BLU,
  "2":           AMB,
  "2.5":         ORG,
  "3-Claude":    RSE,
  "3-Gemini":    "#D05878",
  "3-Fast":      "#C84060",
};
const MODE_C = {
  JARVIS: GRN, WORKSHOP: BLU, WORKSTATION: AMB,
  REMOTE: PRP, NOMAD: ORG,
  "CLOUD-ONLY": RSE, "WORKSHOP-OFFLINE": "#6880C0",
};
const MODE_DESC = {
  JARVIS:              "All tiers available. Full local inference stack. Maximum parallelism.",
  WORKSHOP:            "Single-node mode. Bifrost profiles compensating. Forge offline.",
  WORKSTATION:         "Forge-primary. Bifrost offline. Full large-model capability.",
  REMOTE:              "Surface thin client via Tailscale. Full stack via tunnel.",
  NOMAD:               "Forge portable. Disconnected from LAN. Cloud fallback active.",
  "CLOUD-ONLY":        "Emergency mode. Embeddings + cloud APIs only.",
  "WORKSHOP-OFFLINE":  "Privacy mode. Zero cloud egress. Local inference only.",
};

// ═══════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════
const M_STATUS = {
  mode: "JARVIS", confidence: 0.98,
  tiers: ["1a-coder","1a-instruct","1b","2","2.5","3-Claude","3-Gemini","3-Fast"],
  machines: {
    bifrost: {
      up: true, profile: "B-Dual",
      gpu: {
        port: 11434, label: "9070 XT",
        model: "qwen3:14b",
        vram_used: 9.8, vram_total: 14.5, tok_s: 38,
      },
      cpu: {
        port: 11435, label: "CPU",
        model: "qwen2.5:1.7b",
        tok_s: 12, role: "classifier",
      },
    },
    hearth: {
      up: true,
      primary: {
        port: 11434, gpu: "RX 5700 XT",
        model: "qwen2.5-coder:7b",
        vram_used: 7.1, vram_total: 8.0, tok_s: 53,
      },
      vega8: {
        port: 11436, gpu: "Vega 8 iGPU",
        model: "qwen3.5:4b QM",
        gtt_used: 5.2, gtt_total: 16.0, tok_s: 13,
        embed_loaded: true,
      },
    },
    forge: {
      up: true, profile: "F-Multi",
      slots: [
        { tier: "1b",  port: 11434, model: "qwen2.5-coder:14b", vram_used: 9.2,  tok_s: 38, active: true  },
        { tier: "2",   port: 11434, model: "qwen2.5-coder:32b", vram_used: 20.1, tok_s: 18, active: true  },
        { tier: "2.5", port: 11434, model: "qwen2.5:72b Q4",    vram_used: 42.0, tok_s: 7,  active: false },
      ],
      vram_used: 29.3, vram_total: 96.0,
    },
  },
  arbiter: {
    connected: true, debouncing: false,
    last_transition: "2026-03-07T12:44:00Z",
    reason: "forge_lan_reachable TRUE",
    history: ["CLOUD-ONLY","WORKSHOP","JARVIS"],
  },
  signals: {
    bifrost_ollama_live:  true,
    hearth_ollama_live:   true,
    hearth_vega8_live:    true,
    hearth_embed_live:    true,
    forge_lan_reachable:  true,
    forge_ollama_live:    true,
    api_available:        true,
  },
};

const rng = (seed) => (Math.sin(seed * 127.1) * 0.5 + 0.5);
const M_METRICS = {
  bands: [
    { n: "TRIVIAL",  v: 1847 },
    { n: "MODERATE", v: 612  },
    { n: "COMPLEX",  v: 134  },
    { n: "FRONTIER", v: 28   },
  ],
  tiers: [
    { k: "1a-coder",    v: 1744 },
    { k: "1a-instruct", v: 318  },
    { k: "1b",          v: 421  },
    { k: "2",           v: 89   },
    { k: "2.5",         v: 56   },
    { k: "3-Claude",    v: 28   },
    { k: "3-Gemini",    v: 12   },
    { k: "3-Fast",      v: 8    },
  ],
  localPct: 87.6, local: 2628, cloud: 374,
  p50: 124, p90: 890, p99: 3240,
  sparkline: Array.from({ length: 30 }, (_, i) => ({
    t: i,
    v: parseFloat((0.5 + Math.sin(i / 3) * 0.25 + rng(i) * 0.35).toFixed(3)),
  })),
  costDay: 1.24, costWeek: 8.47, costMonth: 31.20, budgetDay: 20,
};

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════
function deriveStatus(raw) {
  const sig = raw.signals || {};
  const sigBool = (k) => sig[k]?.value === "TRUE";
  const normalSignals = Object.fromEntries(
    Object.entries(sig).map(([k, v]) => [k, v?.value === "TRUE"])
  );
  const bifrostModels = raw.bifrost_loaded_models || [];
  const bCoder    = bifrostModels.find(m => m.includes("coder")) || bifrostModels[0] || "—";
  const bInstruct = bifrostModels.find(m => !m.includes("coder")) || "—";
  const forgeTiers = (raw.tiers || []).filter(t => t.machine === "Forge");
  const machines = {
    bifrost: {
      up:      sigBool("bifrost_ollama_live"),
      profile: raw.bifrost_profile || null,
      gpu: { label:"9070 XT", port:11434, model:bCoder,    vram_used:null, vram_total:14.5, tok_s:null },
      cpu: { label:"CPU",     port:11435, model:bInstruct, tok_s:null, role:"classifier" },
    },
    hearth: {
      up: sigBool("hearth_ollama_live"),
      primary: { port:11434, gpu:"RX 5700 XT",  model:"qwen2.5-coder:7b", vram_used:null, vram_total:8.0,  tok_s:null },
      vega8:   { port:11436, gpu:"Vega 8 iGPU", model:"qwen3.5:4b QM",   gtt_used:null,  gtt_total:16.0, tok_s:null, embed_loaded:sigBool("hearth_embed_live") },
    },
    forge: {
      up:         sigBool("forge_lan_reachable"),
      profile:    raw.forge_profile || null,
      slots:      forgeTiers.map(t => ({ tier:t.tier, model:t.model, vram_used:0, tok_s:null, active:t.status==="available"||t.status==="healthy" })),
      vram_used:  (raw.forge_vram_used_bytes || 0) / 1e9,
      vram_total: 96.0,
    },
  };
  return { ...raw, signals: normalSignals, machines };
}

async function fetchStatus() {
  if (MOCK) return M_STATUS;
  try {
    const r = await fetch(`${BROADCASTER}/system/status`);
    return deriveStatus(await r.json());
  } catch { return M_STATUS; }
}

async function fetchArbiter() {
  try {
    const [mode, transitions] = await Promise.all([
      fetch(`${ARBITER}/mode`).then(r => r.json()),
      fetch(`${ARBITER}/transitions`).then(r => r.json()),
    ]);
    const last = transitions?.[0];
    return {
      connected:       true,
      debouncing:      !!mode.candidate_mode,
      last_transition: last ? new Date(last.timestamp * 1000).toISOString() : null,
      reason:          last ? `${last.trigger}` : null,
      history:         transitions?.map(t => t.to_mode) || [],
    };
  } catch { return { connected: false, debouncing: false }; }
}

async function pq(query) {
  const url = `${PROMETHEUS}/api/v1/query?query=${encodeURIComponent(query)}`;
  const r = await fetch(url);
  const d = await r.json();
  return d.data?.result || [];
}

async function fetchMetrics() {
  if (MOCK) return M_METRICS;
  try {
    const [bands, tiers, localPct, localTot, cloudTot, p50r, p90r, p99r, spark] =
      await Promise.allSettled([
        pq('bifrost_band_total'),
        pq('bifrost_tier_total'),
        pq('bifrost_local_percentage'),
        pq('bifrost_local_requests_total'),
        pq('bifrost_cloud_requests_total'),
        pq('histogram_quantile(0.5, rate(bifrost_request_latency_ms_bucket[5m]))'),
        pq('histogram_quantile(0.9, rate(bifrost_request_latency_ms_bucket[5m]))'),
        pq('histogram_quantile(0.99, rate(bifrost_request_latency_ms_bucket[5m]))'),
        pq('rate(bifrost_requests_total[1m])'),
      ]);

    const getVal = (r) => r.status === "fulfilled" ? parseFloat(r.value?.[0]?.value?.[1] || 0) : 0;
    const getLabeled = (r, label) =>
      r.status === "fulfilled"
        ? r.value.map(item => ({ k: item.metric[label], v: parseFloat(item.value[1]) }))
        : [];

    return {
      bands:    getLabeled(bands, "band").map(x => ({ n: x.k.toUpperCase(), v: x.v })),
      tiers:    getLabeled(tiers, "tier"),
      localPct: getVal(localPct),
      local:    getVal(localTot),
      cloud:    getVal(cloudTot),
      p50:      Math.round(getVal(p50r)),
      p90:      Math.round(getVal(p90r)),
      p99:      Math.round(getVal(p99r)),
      sparkline: M_METRICS.sparkline, // TODO: range query for sparkline
      costDay:   M_METRICS.costDay,
      costWeek:  M_METRICS.costWeek,
      costMonth: M_METRICS.costMonth,
      budgetDay: M_METRICS.budgetDay,
    };
  } catch { return M_METRICS; }
}

// ═══════════════════════════════════════════════════════════
// PRIMITIVES
// ═══════════════════════════════════════════════════════════
function PulseDot({ alive, size = 8 }) {
  return (
    <span style={{
      display: "inline-block", width: size, height: size,
      borderRadius: "50%",
      background: alive ? GRN : RSE,
      boxShadow: alive ? `0 0 6px ${GRN}90` : `0 0 4px ${RSE}60`,
      animation: alive ? "blink 2.4s ease-in-out infinite" : "none",
      flexShrink: 0,
    }} />
  );
}

function Panel({ children, style, span }) {
  return (
    <div style={{
      background: SURF,
      border: `1px solid ${BORD}`,
      borderRadius: 8,
      padding: "18px 20px",
      gridColumn: span || "auto",
      ...style,
    }}>
      {children}
    </div>
  );
}

function Label({ children, style }) {
  return (
    <div style={{
      fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
      color: TXD, marginBottom: 12,
      fontFamily: "Plus Jakarta Sans, sans-serif", fontWeight: 600,
      ...style,
    }}>
      {children}
    </div>
  );
}

function BigNum({ value, unit, color, size = 34 }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
      <span style={{
        fontSize: size, fontWeight: 600,
        fontFamily: "'JetBrains Mono', monospace",
        color: color || TX, lineHeight: 1,
      }}>{value}</span>
      {unit && <span style={{ fontSize: 12, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>{unit}</span>}
    </div>
  );
}

function VramBar({ used, total, color = BLU }) {
  const pct = (used == null || !total) ? 0 : Math.min((used / total) * 100, 100);
  const warn = pct > 85;
  const barColor = warn ? AMB : color;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>
          {used != null ? `${used}GB` : "—"} / {total}GB
        </span>
        <span style={{ fontSize: 10, color: warn ? AMB : TXD, fontFamily: "'JetBrains Mono', monospace" }}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{ height: 5, background: BORD, borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: barColor, borderRadius: 3,
          transition: "width 0.6s ease",
          boxShadow: `0 0 8px ${barColor}60`,
        }} />
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: ELEV, border: `1px solid ${BORDB}`,
      borderRadius: 6, padding: "7px 11px",
    }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: TX }}>
        {payload[0]?.value?.toFixed(2)}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// TOP NAV
// ═══════════════════════════════════════════════════════════
function TopNav({ status, surface, setSurface, mockOverride, setMockOverride }) {
  const mode      = status?.mode || "—";
  const modeColor = MODE_C[mode] || TXD;
  const rawTiers  = status?.tiers || [];
  // Broadcaster returns tier objects {tier, status, model, machine} — build a Set of active names
  const activeTiers = new Set(
    rawTiers.filter(t => t.status !== "stub").map(t => t.tier)
  );

  return (
    <div style={{
      height: 52, display: "flex", alignItems: "center",
      padding: "0 16px", borderBottom: `1px solid ${BORD}`,
      background: SURF, gap: 12, flexShrink: 0, zIndex: 10,
    }}>
      {/* Logotype */}
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontWeight: 600, fontSize: 15, color: TX,
        letterSpacing: "0.06em", userSelect: "none",
      }}>
        <span style={{ color: modeColor, transition: "color 0.5s" }}>B</span>IFROST
      </div>

      <div style={{ width: 1, height: 24, background: BORD }} />

      {/* Mode badge */}
      <div style={{
        display: "flex", alignItems: "center", gap: 7,
        background: `${modeColor}15`, border: `1px solid ${modeColor}40`,
        borderRadius: 20, padding: "4px 12px", transition: "all 0.5s",
      }}>
        <PulseDot alive={true} size={6} />
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: modeColor, fontWeight: 500, letterSpacing: "0.07em",
        }}>{mode}</span>
      </div>

      {/* Tier strip */}
      <div style={{ display: "flex", gap: 4, flex: 1, justifyContent: "center", overflow: "hidden", minWidth: 0 }}>
        {Object.entries(TIER_C).map(([tier, color]) => {
          const on = activeTiers.has(tier);
          return (
            <div key={tier} style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5,
              padding: "3px 7px", borderRadius: 4, flexShrink: 0,
              background: on ? `${color}18` : BORD,
              color: on ? color : TXM,
              border: `1px solid ${on ? color + "45" : BORD}`,
              letterSpacing: "0.04em", transition: "all 0.4s",
              opacity: on ? 1 : 0.45,
            }}>{tier}</div>
          );
        })}
      </div>

      {/* Live/Mock toggle */}
      <div onClick={() => setMockOverride(m => !m)} style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
        color: mockOverride ? AMB : GRN,
        background: mockOverride ? `${AMB}18` : `${GRN}18`,
        border: `1px solid ${mockOverride ? AMB : GRN}40`,
        borderRadius: 3, padding: "2px 6px",
        cursor: "pointer", userSelect: "none",
      }}>{mockOverride ? "MOCK" : "LIVE"}</div>

      {/* Nav tabs */}
      <div style={{ display: "flex", gap: 3 }}>
        {["Observe", "Converse", "Command"].map(s => (
          <button key={s} onClick={() => setSurface(s)} style={{
            fontFamily: "Plus Jakarta Sans, sans-serif",
            fontSize: 12, fontWeight: 500,
            padding: "5px 14px", borderRadius: 6,
            background: surface === s ? `${BLU}22` : "transparent",
            color: surface === s ? BLU : TXD,
            border: surface === s ? `1px solid ${BLU}45` : "1px solid transparent",
            cursor: "pointer", transition: "all 0.18s",
          }}>{s}</button>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MODE HERO
// ═══════════════════════════════════════════════════════════
function ModeHero({ status }) {
  const mode      = status?.mode || "—";
  const sigs = Object.values(status?.signals || {});
  const conf = sigs.length ? sigs.filter(Boolean).length / sigs.length : 0;
  const modeColor = MODE_C[mode] || GRN;
  const tiers     = status?.tiers || [];
  const activeTierSet = new Set(tiers.filter(t => t.status !== "stub").map(t => t.tier));
  return (
    <Panel
      span="1 / -1"
      style={{
        background: `linear-gradient(140deg, ${SURF} 0%, ${modeColor}0A 100%)`,
        borderColor: `${modeColor}35`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        {/* Mode name + desc */}
        <div style={{ minWidth: 220 }}>
          <div style={{
            fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif",
            textTransform: "uppercase", letterSpacing: "0.14em", marginBottom: 8,
          }}>Active Mode</div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            fontSize: 26, color: modeColor, letterSpacing: "0.04em",
            transition: "color 0.5s",
          }}>{mode}</div>
          <div style={{
            fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 11,
            color: TXD, marginTop: 5, lineHeight: 1.5, maxWidth: 340,
          }}>{MODE_DESC[mode] || ""}</div>
        </div>

        <div style={{ width: 1, height: 64, background: BORD }} />

        {/* Confidence */}
        <div style={{ textAlign: "center", minWidth: 80 }}>
          <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8 }}>Confidence</div>
          <BigNum
            value={(conf * 100).toFixed(0)}
            unit="%"
            color={conf > 0.9 ? GRN : conf > 0.7 ? AMB : RSE}
            size={26}
          />
        </div>

        <div style={{ width: 1, height: 64, background: BORD }} />

        {/* Available tiers */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10 }}>Available Tiers</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {Object.entries(TIER_C).map(([tier, color]) => {
              const on = activeTierSet.has(tier);
              return (
                <div key={tier} style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                  padding: "4px 9px", borderRadius: 4,
                  background: on ? `${color}1A` : BORD,
                  color: on ? color : TXM,
                  border: `1px solid ${on ? color + "50" : BORD}`,
                  transition: "all 0.4s",
                  opacity: on ? 1 : 0.35,
                }}>{tier}</div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// MACHINE CARD
// ═══════════════════════════════════════════════════════════
const MACHINE_META = {
  bifrost: { ip: "192.168.2.33", color: GRN,  role: "Primary Workstation" },
  hearth:  { ip: "192.168.2.4",  color: BLU,  role: "Always-On Server"    },
  forge:   { ip: "192.168.2.50", color: ORG,  role: "Large Model Compute" },
};

function MachineCard({ name, data, signals }) {
  if (!data) return null;
  const meta = MACHINE_META[name];
  const mySignals = Object.entries(signals || {})
    .filter(([k]) => k.startsWith(name))
    .slice(0, 3);

  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            fontSize: 13, color: meta.color, textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}>{name}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXM, marginTop: 2 }}>
            {meta.ip}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <PulseDot alive={data.up} />
          <div style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 8.5, color: TXM }}>{meta.role}</div>
        </div>
      </div>

      {/* Model name */}
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD,
        marginBottom: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        background: BORD, padding: "4px 8px", borderRadius: 4,
      }}>
        {data.model}
      </div>

      <VramBar used={data.vram_used} total={data.vram_total} color={meta.color} />

      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>Output</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: TX }}>
            {data.tok_s ?? "—"}<span style={{ fontSize: 9, color: TXD }}> tok/s</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
          {data.profile && (
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
              color: meta.color, background: `${meta.color}15`,
              border: `1px solid ${meta.color}40`, borderRadius: 3, padding: "2px 6px",
            }}>{data.profile}</div>
          )}
          {mySignals.map(([k, v]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 8.5, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>
                {k.replace(`${name}_`, "").replace(/_/g, " ")}
              </span>
              <PulseDot alive={v} size={5} />
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}



// ═══════════════════════════════════════════════════════════
// BIFROST CARD — dual Ollama instances (GPU + CPU classifier)
// ═══════════════════════════════════════════════════════════
function BifrostCard({ data, signals }) {
  if (!data) return null;
  const { gpu, cpu, profile } = data;
  const PROFILE_C = { "B-Light": GRN, "B-Dual": BLU, "B-Heavy": ORG };
  const profColor = PROFILE_C[profile] || GRN;

  return (
    <Panel>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            fontSize: 13, color: GRN, textTransform: "uppercase", letterSpacing: "0.07em",
          }}>BIFROST</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXM, marginTop: 2 }}>
            192.168.2.33
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <PulseDot alive={data.up} />
          <div style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 8.5, color: TXM }}>Primary Workstation</div>
        </div>
      </div>

      {/* Profile badge */}
      {profile && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>GPU Profile</div>
          <div style={{ display: "flex", gap: 5 }}>
            {["B-Light","B-Dual","B-Heavy"].map(p => (
              <div key={p} style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
                padding: "2px 7px", borderRadius: 3,
                background: profile === p ? `${PROFILE_C[p]}18` : BORD,
                color: profile === p ? PROFILE_C[p] : TXM,
                border: `1px solid ${profile === p ? PROFILE_C[p] + "45" : BORD}`,
              }}>{p}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── GPU instance ── */}
      <div style={{
        background: ELEV, borderRadius: 6, padding: "10px 12px", marginBottom: 8,
        border: `1px solid ${BORDB}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: 1, background: GRN, flexShrink: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: GRN }}>{gpu.label}</span>
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM }}>:{gpu.port}</span>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD,
          background: BORD, padding: "3px 7px", borderRadius: 3, marginBottom: 8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{gpu.model}</div>
        <VramBar used={gpu.vram_used} total={gpu.vram_total} color={GRN} />
        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: TX }}>{gpu.tok_s ?? "—"}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD }}> tok/s</span>
        </div>
      </div>

      {/* ── CPU classifier ── */}
      <div style={{
        background: ELEV, borderRadius: 6, padding: "10px 12px",
        border: `1px solid ${BORDB}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: 1, background: TXM, flexShrink: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD }}>{cpu.label}</span>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 7.5, color: AMB,
              background: `${AMB}15`, border: `1px solid ${AMB}40`,
              borderRadius: 3, padding: "1px 5px",
            }}>{cpu.role}</div>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM }}>:{cpu.port}</span>
          </div>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD,
          background: BORD, padding: "3px 7px", borderRadius: 3, marginBottom: 8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{cpu.model}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: TX }}>{cpu.tok_s ?? "—"}</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD }}> tok/s</span>
        </div>
      </div>

      {/* Signals */}
      <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {[["ollama live", signals?.bifrost_ollama_live]].map(([label, val]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 8.5, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
            <PulseDot alive={val} size={5} />
          </div>
        ))}
      </div>
    </Panel>
  );
}


// ═══════════════════════════════════════════════════════════
// FORGE CARD — profile slots (F-Multi / F-Max)
// ═══════════════════════════════════════════════════════════
function ForgeCard({ data, signals }) {
  if (!data) return null;
  const { slots, profile, vram_used, vram_total } = data;
  const PROFILE_C = { "F-Multi": ORG, "F-Max": RSE };
  const profColor = PROFILE_C[profile] || ORG;
  const SLOT_C = { "1b": BLU, "2": AMB, "2.5": ORG };

  return (
    <Panel>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            fontSize: 13, color: ORG, textTransform: "uppercase", letterSpacing: "0.07em",
          }}>FORGE</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXM, marginTop: 2 }}>
            192.168.2.50
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <PulseDot alive={data.up} />
          <div style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 8.5, color: TXM }}>Large Model Compute</div>
        </div>
      </div>

      {/* Profile selector */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Active Profile</div>
        <div style={{ display: "flex", gap: 5 }}>
          {["F-Multi","F-Max"].map(p => (
            <div key={p} style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
              padding: "2px 7px", borderRadius: 3,
              background: profile === p ? `${PROFILE_C[p]}18` : BORD,
              color: profile === p ? PROFILE_C[p] : TXM,
              border: `1px solid ${profile === p ? PROFILE_C[p] + "45" : BORD}`,
            }}>{p}</div>
          ))}
        </div>
      </div>

      {/* Total VRAM bar */}
      <div style={{ marginBottom: 10 }}>
        <VramBar used={vram_used} total={vram_total} color={profColor} />
      </div>

      {/* Tier slots */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {slots.map(slot => (
          <div key={slot.tier} style={{
            background: ELEV, borderRadius: 6, padding: "8px 12px",
            border: `1px solid ${slot.active ? BORDB : BORD}`,
            opacity: slot.active ? 1 : 0.45,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: 1, background: SLOT_C[slot.tier] || TXD, flexShrink: 0 }} />
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: SLOT_C[slot.tier] || TXD }}>
                  Tier {slot.tier}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {!slot.active && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7.5, color: TXM }}>unloaded</span>
                )}
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: TXM }}>
                  {slot.vram_used ? `${slot.vram_used}GB` : "—"}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: slot.active ? TXD : TXM,
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "70%",
              }}>{slot.model}</div>
              {slot.active && (
                <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: TX }}>{slot.tok_s ?? "—"}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: TXD }}>tok/s</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Signals */}
      <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "flex-end" }}>
        {[["lan reachable", signals?.forge_lan_reachable]].map(([label, val]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 8.5, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
            <PulseDot alive={val} size={5} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// HEARTH CARD — dual GPU instances
// ═══════════════════════════════════════════════════════════
function GttBar({ used, total }) {
  const pct   = Math.min((used / total) * 100, 100);
  const warn  = pct > 80;
  const color = warn ? AMB : "#4E78C4";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <span style={{ fontSize: 10, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>
          {used != null ? `${used}GB` : "—"} / {total}GB GTT
        </span>
        <span style={{ fontSize: 10, color: warn ? AMB : TXD, fontFamily: "'JetBrains Mono', monospace" }}>
          {pct.toFixed(0)}%
        </span>
      </div>
      <div style={{ height: 5, background: BORD, borderRadius: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: `repeating-linear-gradient(
            60deg,
            ${color}CC,
            ${color}CC 4px,
            ${color}60 4px,
            ${color}60 8px
          )`,
          borderRadius: 3, transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

function HearthCard({ data, signals }) {
  if (!data) return null;
  const { primary, vega8 } = data;

  // relevant signals
  const sigMap = {
    "ollama live":  signals?.hearth_ollama_live,
    "vega8 live":   signals?.hearth_embed_live,   // proxy: embed served by Vega 8
    "embed live":   signals?.hearth_embed_live,
  };

  return (
    <Panel>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <div style={{
            fontFamily: "'JetBrains Mono', monospace", fontWeight: 600,
            fontSize: 13, color: BLU, textTransform: "uppercase", letterSpacing: "0.07em",
          }}>HEARTH</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXM, marginTop: 2 }}>
            192.168.2.4
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <PulseDot alive={data.up} />
          <div style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 8.5, color: TXM }}>
            Always-On Server
          </div>
        </div>
      </div>

      {/* ── Primary: RX 5700 XT ── */}
      <div style={{
        background: ELEV, borderRadius: 6, padding: "10px 12px", marginBottom: 8,
        border: `1px solid ${BORDB}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: 1, background: BLU, flexShrink: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: BLU }}>
              {primary.gpu}
            </span>
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM }}>
            :{primary.port}
          </span>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD,
          background: BORD, padding: "3px 7px", borderRadius: 3, marginBottom: 8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {primary.model}
        </div>
        <VramBar used={primary.vram_used} total={primary.vram_total} color={BLU} />
        <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 3 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: TX }}>
            {primary.tok_s ?? "—"}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD }}>tok/s</span>
        </div>
      </div>

      {/* ── Vega 8 iGPU ── */}
      <div style={{
        background: ELEV, borderRadius: 6, padding: "10px 12px",
        border: `1px solid ${BORDB}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 5, height: 5, borderRadius: 1, background: "#4E78C4", flexShrink: 0 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: "#7898C4" }}>
              {vega8.gpu}
            </span>
          </div>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM }}>
            :{vega8.port}
          </span>
        </div>
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD,
          background: BORD, padding: "3px 7px", borderRadius: 3, marginBottom: 8,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {vega8.model}
        </div>
        <GttBar used={vega8.gtt_used} total={vega8.gtt_total} />
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: TX }}>
              {vega8.tok_s ?? "—"}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD }}>tok/s</span>
          </div>
          {vega8.embed_loaded && (
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: GRN,
              background: `${GRN}15`, border: `1px solid ${GRN}40`,
              borderRadius: 3, padding: "2px 6px",
            }}>embed loaded</div>
          )}
        </div>
      </div>

      {/* Signals */}
      <div style={{ marginTop: 10, display: "flex", gap: 12, justifyContent: "flex-end" }}>
        {Object.entries(sigMap).map(([label, val]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 8.5, color: TXD, fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
            <PulseDot alive={val} size={5} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// BAND DONUT
// ═══════════════════════════════════════════════════════════
function BandDonut({ bands }) {
  const total = bands.reduce((s, b) => s + b.v, 0);
  const DonutTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: ELEV, border: `1px solid ${BORDB}`, borderRadius: 6, padding: "7px 11px" }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: BAND_C[payload[0].name] }}>{payload[0].name}</div>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: TX }}>{payload[0].value.toLocaleString()}</div>
      </div>
    );
  };

  return (
    <Panel>
      <Label>Complexity Distribution</Label>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ flexShrink: 0 }}>
          <ResponsiveContainer width={110} height={110}>
            <PieChart>
              <Pie
                data={bands.map(b => ({ name: b.n, value: b.v }))}
                cx="50%" cy="50%"
                innerRadius={32} outerRadius={52}
                dataKey="value" strokeWidth={0} paddingAngle={2}
              >
                {bands.map(b => <Cell key={b.n} fill={BAND_C[b.n]} />)}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1 }}>
          {bands.map(b => (
            <div key={b.n} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: BAND_C[b.n], flexShrink: 0 }} />
                <span style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 11, color: TXD }}>{b.n}</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: TX }}>{b.v.toLocaleString()}</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXM, minWidth: 30, textAlign: "right" }}>
                  {((b.v / total) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${BORD}`, display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif" }}>Total requests</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: TX }}>{total.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// TIER BARS
// ═══════════════════════════════════════════════════════════
function TierBars({ tiers }) {
  const max = Math.max(...tiers.map(t => t.v), 1);
  return (
    <Panel>
      <Label>Tier Hit Rates</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tiers.map(({ k, v }) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              width: 72, fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
              color: TIER_C[k] || TXD, textAlign: "right", flexShrink: 0,
            }}>{k}</div>
            <div style={{ flex: 1, height: 13, background: BORD, borderRadius: 3, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${(v / max) * 100}%`,
                background: TIER_C[k] || BLU, borderRadius: 3,
                transition: "width 0.7s ease",
                opacity: 0.82,
              }} />
            </div>
            <div style={{ width: 38, fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD, textAlign: "right" }}>
              {v.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// LOCAL / CLOUD SPLIT
// ═══════════════════════════════════════════════════════════
function LocalCloudPanel({ localPct, local, cloud }) {
  const gc = localPct > 85 ? GRN : localPct > 70 ? AMB : RSE;
  return (
    <Panel>
      <Label>Local / Cloud Split</Label>
      <div style={{ textAlign: "center", padding: "6px 0 10px" }}>
        <BigNum value={localPct.toFixed(1)} unit="%" color={gc} size={32} />
        <div style={{ fontSize: 9.5, color: TXD, fontFamily: "Plus Jakarta Sans, sans-serif", marginTop: 4 }}>
          local inference
        </div>
      </div>
      <div style={{ height: 7, background: BORD, borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
        <div style={{
          height: "100%", width: `${localPct}%`,
          background: `linear-gradient(90deg, ${GRN}, ${gc})`,
          borderRadius: 4, transition: "width 0.6s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-around" }}>
        {[[local, "local", GRN], [cloud, "cloud", RSE]].map(([n, lbl, c]) => (
          <div key={lbl} style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 15, color: c }}>{n.toLocaleString()}</div>
            <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em" }}>{lbl}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// LATENCY
// ═══════════════════════════════════════════════════════════
function LatencyPanel({ p50, p90, p99 }) {
  const fmt = ms => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const rows = [["p50", p50, GRN], ["p90", p90, AMB], ["p99", p99, RSE]];
  return (
    <Panel>
      <Label>Request Latency</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {rows.map(([pct, ms, color]) => (
          <div key={pct} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD }}>{pct}</span>
            <div style={{ flex: 1, height: 1, background: BORD, margin: "0 12px", opacity: 0.6 }} />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color, fontWeight: 500 }}>
              {fmt(ms)}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// THROUGHPUT SPARKLINE
// ═══════════════════════════════════════════════════════════
function ThroughputPanel({ sparkline }) {
  const cur = sparkline[sparkline.length - 1]?.v || 0;
  return (
    <Panel>
      <Label>Throughput</Label>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 10 }}>
        <BigNum value={cur.toFixed(2)} unit="req/s" color={BLU} size={28} />
        <span style={{ fontSize: 8.5, color: TXM, fontFamily: "'JetBrains Mono', monospace" }}>rate(5m)</span>
      </div>
      <ResponsiveContainer width="100%" height={52}>
        <AreaChart data={sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={BLU} stopOpacity={0.28} />
              <stop offset="95%" stopColor={BLU} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="v" stroke={BLU} strokeWidth={1.5} fill="url(#spk)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// COST TRACKER
// ═══════════════════════════════════════════════════════════
function CostPanel({ costDay, costWeek, costMonth, budgetDay }) {
  const pct   = Math.min((costDay / budgetDay) * 100, 100);
  const color = pct < 50 ? GRN : pct < 80 ? AMB : RSE;
  return (
    <Panel>
      <Label>Cloud Spend</Label>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        {[["Today", costDay, color, true], ["Week", costWeek, TXD, false], ["Month", costMonth, TXD, false]].map(
          ([lbl, val, c, big]) => (
            <div key={lbl} style={{ flex: 1, textAlign: "center" }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: big ? 22 : 14, color: c, fontWeight: big ? 600 : 400,
              }}>${val.toFixed(2)}</div>
              <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>{lbl}</div>
            </div>
          )
        )}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif" }}>Daily budget</span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color }}>{pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 5, background: BORD, borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`,
            background: color, borderRadius: 3, transition: "width 0.6s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: 8.5, color: TXM, fontFamily: "'JetBrains Mono', monospace" }}>$0</span>
          <span style={{ fontSize: 8.5, color: TXM, fontFamily: "'JetBrains Mono', monospace" }}>${budgetDay}/day cap</span>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// SIGNALS + ARBITER
// ═══════════════════════════════════════════════════════════
function SignalsPanel({ signals, arbiter }) {
  const entries = Object.entries(signals || {});
  // Signals excluded from health score — stubs or future phases not yet active
  const STUB_SIGNALS = new Set([
    "forge_tailscale_reachable",  // Phase 4 — not configured
    "forge_npu_available",         // Phase 3 stub — not configured
    "hearth_k3d_healthy",          // known auth issue, low priority
    "forge_model_loaded",          // operational state (idle Forge ≠ fault); forge_lan_reachable covers health
    "forge_gpu_offload",           // operational state (no models loaded ≠ fault)
  ]);
  const healthEntries = entries.filter(([k]) => !STUB_SIGNALS.has(k));
  const allLive = healthEntries.every(([, v]) => v);

  return (
    <Panel span="1 / -1">
      <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
        {/* Signals grid */}
        <div style={{ flex: 1 }}>
          <Label>System Signals</Label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "7px 20px" }}>
            {entries.map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <PulseDot alive={v} size={5} />
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
                  color: v ? TXD : RSE,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {k.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ width: 1, alignSelf: "stretch", background: BORD }} />

        {/* Arbiter status */}
        <div style={{ minWidth: 220 }}>
          <Label>Arbiter</Label>
          <div style={{ display: "flex", gap: 16 }}>
            {[
              ["Broadcaster", arbiter?.connected, "connected"],
              ["Debouncing",  arbiter?.debouncing, "active"],
            ].map(([lbl, val, activeWord]) => (
              <div key={lbl}>
                <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{lbl}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <PulseDot alive={lbl === "Debouncing" ? !val : val} size={5} />
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: TXD }}>
                    {lbl === "Debouncing" ? (val ? "active" : "idle") : (val ? "connected" : "disconnected")}
                  </span>
                </div>
              </div>
            ))}
          </div>
          {arbiter?.reason && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Last Transition</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: TXD }}>{arbiter.reason}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM, marginTop: 2 }}>
                {new Date(arbiter.last_transition).toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>

        <div style={{ width: 1, alignSelf: "stretch", background: BORD }} />

        {/* Fleet health summary */}
        <div style={{ minWidth: 120, textAlign: "center" }}>
          <Label style={{ textAlign: "center" }}>Fleet Health</Label>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, color: allLive ? GRN : AMB, fontWeight: 600 }}>
            {healthEntries.filter(([, v]) => v).length}
            <span style={{ fontSize: 14, color: TXD }}>/{healthEntries.length}</span>
          </div>
          <div style={{ fontSize: 9, color: allLive ? GRN : AMB, fontFamily: "Plus Jakarta Sans, sans-serif", marginTop: 4 }}>
            {allLive ? "All signals nominal" : "Degraded signals"}
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════════════
// OBSERVE SURFACE
// ═══════════════════════════════════════════════════════════
function ObserveSurface({ status, metrics }) {
  if (!status || !metrics) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: TXD }}>Connecting…</div>
      </div>
    );
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "18px 20px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>

        {/* Row 1: Mode hero — full width */}
        <ModeHero status={status} />

        {/* Row 2: Machine cards */}
        <BifrostCard data={status.machines.bifrost} signals={status.signals} />
        <HearthCard  data={status.machines.hearth}  signals={status.signals} />
        <ForgeCard   data={status.machines.forge}   signals={status.signals} />

        {/* Row 3: Band + Tiers + Local split */}
        <BandDonut  bands={metrics.bands} />
        <TierBars   tiers={metrics.tiers} />
        <LocalCloudPanel localPct={metrics.localPct} local={metrics.local} cloud={metrics.cloud} />

        {/* Row 4: Latency + Throughput + Cost */}
        <LatencyPanel   p50={metrics.p50} p90={metrics.p90} p99={metrics.p99} />
        <ThroughputPanel sparkline={metrics.sparkline} />
        <CostPanel
          costDay={metrics.costDay} costWeek={metrics.costWeek}
          costMonth={metrics.costMonth} budgetDay={metrics.budgetDay}
        />

        {/* Row 5: Signals — full width */}
        <SignalsPanel signals={status.signals} arbiter={status.arbiter} />

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CONVERSE SURFACE
// ═══════════════════════════════════════════════════════════

function RoutingPill({ tier, latency, tokS, escalation, docsUsed }) {
  const color = TIER_C[tier] || TXD;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        background: `${color}12`, border: `1px solid ${color}35`,
        borderRadius: 4, padding: "2px 7px",
      }}>
        <div style={{ width: 5, height: 5, borderRadius: 1, background: color }} />
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color }}>
          {tier}
        </span>
        {tokS != null && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: TXD }}>
            · {tokS} tok/s
          </span>
        )}
        {latency != null && (
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: TXD }}>
            · {latency}ms
          </span>
        )}
      </div>
      {escalation && escalation.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          {escalation.map((t, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              {i > 0 && <span style={{ color: TXM, fontSize: 8 }}>→</span>}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
                color: TIER_C[t] || TXD,
                background: `${TIER_C[t] || TXD}10`,
                border: `1px solid ${TIER_C[t] || TXD}30`,
                borderRadius: 3, padding: "1px 5px",
              }}>{t}</span>
            </span>
          ))}
        </div>
      )}
      {docsUsed > 0 && (
        <div style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: BLU,
          background: `${BLU}10`, border: `1px solid ${BLU}30`,
          borderRadius: 4, padding: "2px 7px",
        }}>
          📄 {docsUsed} doc{docsUsed !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      marginBottom: 16,
    }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
        color: isUser ? TXM : TXD,
        marginBottom: 4, letterSpacing: "0.1em", textTransform: "uppercase",
      }}>
        {isUser ? "YOU" : "BIFROST"}
      </div>
      <div style={{
        maxWidth: "78%",
        background: isUser ? ELEV : SURF,
        border: `1px solid ${isUser ? BORDB : BORD}`,
        borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
        padding: "12px 16px",
      }}>
        <div style={{
          fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 13.5,
          color: TX, lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {msg.content}
          {msg.streaming && (
            <span style={{
              display: "inline-block", width: 8, height: 14, marginLeft: 2,
              background: GRN, verticalAlign: "middle",
              animation: "blink 0.8s ease-in-out infinite",
            }} />
          )}
        </div>
      </div>
      {!isUser && msg.tier && (
        <RoutingPill
          tier={msg.tier}
          latency={msg.latency}
          tokS={msg.tokS}
          escalation={msg.escalation}
          docsUsed={msg.docsUsed || 0}
        />
      )}
    </div>
  );
}

function UploadItem({ item }) {
  const statusColor = { uploading: AMB, indexing: BLU, ready: GRN, error: RSE }[item.status] || TXD;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 10px", borderRadius: 5,
      background: ELEV, border: `1px solid ${BORD}`, marginBottom: 4,
    }}>
      <div style={{ width: 5, height: 5, borderRadius: 1, background: statusColor, flexShrink: 0 }} />
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: TXD,
        flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{item.name}</span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: statusColor,
        textTransform: "uppercase", flexShrink: 0,
      }}>{item.status}</span>
    </div>
  );
}

function ProjectSidebar({
  projects, sessions, activeNs, setActiveNs,
  onCreateProject, onDeleteProject,
  onCreateSession, onDeleteSession,
  uploads, onDrop, collapsed, setCollapsed,
}) {
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    onDrop(Array.from(e.dataTransfer.files));
  };
  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreateProject(newName.trim()); setNewName(""); setCreating(false);
  };

  if (collapsed) {
    return (
      <div style={{
        width: 32, background: SURF, borderRight: `1px solid ${BORD}`,
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "12px 0", flexShrink: 0,
      }}>
        <button onClick={() => setCollapsed(false)} style={{
          color: TXD, fontSize: 14, padding: 4, borderRadius: 4,
          background: "none", border: "none", cursor: "pointer",
        }}>▶</button>
      </div>
    );
  }

  return (
    <div style={{
      width: 220, flexShrink: 0, background: SURF,
      borderRight: `1px solid ${BORD}`,
      display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 14px 10px", borderBottom: `1px solid ${BORD}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9,
          color: TXD, textTransform: "uppercase", letterSpacing: "0.12em",
        }}>Knowledge</span>
        <button onClick={() => setCollapsed(true)} style={{
          color: TXM, fontSize: 11, background: "none", border: "none", cursor: "pointer",
        }}>◀</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 0" }}>
        {/* Projects */}
        <div style={{
          fontSize: 8, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif",
          textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 6,
        }}>Projects</div>

        {projects.map(p => {
          const nsKey = `proj:${p.name}`;
          const active = activeNs?.key === nsKey;
          return (
            <div key={p.name} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 8px", borderRadius: 5, marginBottom: 3, cursor: "pointer",
              background: active ? `${GRN}10` : "transparent",
              border: `1px solid ${active ? GRN + "35" : "transparent"}`,
            }} onClick={() => setActiveNs({ key: nsKey, project: p.name, type: "project" })}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: GRN, flexShrink: 0 }} />
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
                color: active ? TX : TXD, flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{p.name}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7.5, color: TXM }}>
                {p.chunks}
              </span>
              {p.name !== "default" && (
                <button onClick={e => { e.stopPropagation(); onDeleteProject(p.name); }} style={{
                  color: TXM, fontSize: 9, background: "none", border: "none",
                  cursor: "pointer", padding: "0 2px", lineHeight: 1,
                }}>×</button>
              )}
            </div>
          );
        })}

        {creating ? (
          <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              placeholder="project name"
              autoFocus
              style={{
                flex: 1, background: ELEV, border: `1px solid ${BORDB}`,
                borderRadius: 4, padding: "4px 8px", color: TX,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9, outline: "none",
              }}
            />
            <button onClick={handleCreate} style={{
              background: `${GRN}20`, border: `1px solid ${GRN}50`,
              borderRadius: 4, color: GRN, fontSize: 10, padding: "2px 6px", cursor: "pointer",
            }}>+</button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)} style={{
            width: "100%", padding: "5px 8px", borderRadius: 5,
            background: "transparent", border: `1px dashed ${BORD}`,
            color: TXM, fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5,
            cursor: "pointer", marginBottom: 10, textAlign: "left",
          }}>+ New Project</button>
        )}

        {/* Sessions */}
        <div style={{
          fontSize: 8, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif",
          textTransform: "uppercase", letterSpacing: "0.12em",
          marginBottom: 6, marginTop: 4, borderTop: `1px solid ${BORD}`, paddingTop: 10,
        }}>Sessions</div>

        {sessions.map(s => {
          const nsKey = `sess:${s.id}`;
          const active = activeNs?.key === nsKey;
          const expiring = s.expires_in_minutes != null && s.expires_in_minutes < 30;
          return (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 8px", borderRadius: 5, marginBottom: 3, cursor: "pointer",
              background: active ? `${AMB}10` : "transparent",
              border: `1px solid ${active ? AMB + "35" : "transparent"}`,
            }} onClick={() => setActiveNs({ key: nsKey, session: s.id, label: s.label, type: "session" })}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: expiring ? RSE : AMB, flexShrink: 0 }} />
              <span style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5,
                color: active ? TX : TXD, flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{s.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7, color: expiring ? RSE : TXM }}>
                {s.expires_in_minutes != null ? `${s.expires_in_minutes}m` : ""}
              </span>
              <button onClick={e => { e.stopPropagation(); onDeleteSession(s.id); }} style={{
                color: TXM, fontSize: 9, background: "none", border: "none",
                cursor: "pointer", padding: "0 2px", lineHeight: 1,
              }}>×</button>
            </div>
          );
        })}

        <button onClick={onCreateSession} style={{
          width: "100%", padding: "5px 8px", borderRadius: 5,
          background: "transparent", border: `1px dashed ${BORD}`,
          color: TXM, fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5,
          cursor: "pointer", marginBottom: 10, textAlign: "left",
        }}>+ New Session (4h)</button>

        {/* Drop zone */}
        <div style={{ borderTop: `1px solid ${BORD}`, paddingTop: 10, marginTop: 4 }}>
          <div style={{
            fontSize: 8, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif",
            textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8,
          }}>Documents</div>

          {!activeNs && (
            <div style={{
              fontSize: 8.5, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif",
              marginBottom: 8, fontStyle: "italic",
            }}>Select a project or session first</div>
          )}

          <label htmlFor="bifrost-file-input" style={{ display: "block", cursor: activeNs ? "pointer" : "not-allowed" }}>
          <div
            onDragOver={e => { e.preventDefault(); if (activeNs) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={activeNs ? handleDrop : e => e.preventDefault()}
            style={{
              border: `1px dashed ${dragOver ? GRN : activeNs ? BORDB : BORD}`,
              borderRadius: 6, padding: "14px 10px", textAlign: "center",
              background: dragOver ? `${GRN}08` : "transparent",
              cursor: activeNs ? "pointer" : "not-allowed",
              transition: "all 0.15s",
              opacity: activeNs ? 1 : 0.4, marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 4 }}>📄</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXD }}>
              Drop files or click
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 7.5, color: TXM, marginTop: 3 }}>
              PDF · DOCX · MD · TXT
            </div>
          </div>
          </label>
          <input
            id="bifrost-file-input"
            ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.md,.txt"
            style={{ display: "none" }}
            disabled={!activeNs}
            onChange={e => { onDrop(Array.from(e.target.files)); e.target.value = ""; }}
          />
          {uploads.map(u => <UploadItem key={u.id} item={u} />)}
        </div>
      </div>
    </div>
  );
}

function ConverseSurface({ status }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [strategy, setStrategy] = useState("INTERACTIVE");
  const [streaming, setStreaming] = useState(false);
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeNs, setActiveNs] = useState({ key: "proj:default", project: "default", type: "project" });
  const [uploads, setUploads] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const threadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { refreshKb(); }, []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  async function refreshKb() {
    try {
      const [p, s] = await Promise.all([
        fetch(`${KB}/projects`).then(r => r.json()),
        fetch(`${KB}/sessions`).then(r => r.json()),
      ]);
      setProjects(Array.isArray(p) ? p : []);
      setSessions(Array.isArray(s) ? s : []);
    } catch (e) { console.warn("bifrost-kb unreachable:", e); }
  }

  async function handleCreateProject(name) {
    await fetch(`${KB}/projects`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refreshKb();
    setActiveNs({ key: `proj:${name}`, project: name, type: "project" });
  }

  async function handleDeleteProject(name) {
    await fetch(`${KB}/projects/${name}`, { method: "DELETE" });
    if (activeNs?.project === name) setActiveNs({ key: "proj:default", project: "default", type: "project" });
    await refreshKb();
  }

  async function handleCreateSession() {
    const label = `Session ${new Date().toLocaleTimeString()}`;
    const res = await fetch(`${KB}/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const s = await res.json();
    await refreshKb();
    setActiveNs({ key: `sess:${s.id}`, session: s.id, label: s.label, type: "session" });
  }

  async function handleDeleteSession(id) {
    await fetch(`${KB}/sessions/${id}`, { method: "DELETE" });
    if (activeNs?.session === id) setActiveNs({ key: "proj:default", project: "default", type: "project" });
    await refreshKb();
  }

  async function handleDrop(files) {
    if (!activeNs) return;
    const valid = files.filter(f => KB_SUPPORTED.some(ext => f.name.endsWith(ext)));
    if (!valid.length) return;
    for (const file of valid) {
      const id = `${file.name}-${Date.now()}`;
      setUploads(u => [...u, { id, name: file.name, status: "uploading" }]);
      const params = activeNs.type === "session"
        ? `?session=${activeNs.session}` : `?project=${activeNs.project}`;
      try {
        setUploads(u => u.map(x => x.id === id ? { ...x, status: "indexing" } : x));
        const fd = new FormData(); fd.append("file", file);
        const res = await fetch(`${KB}/upload${params}`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(await res.text());
        setUploads(u => u.map(x => x.id === id ? { ...x, status: "ready" } : x));
        setTimeout(() => setUploads(u => u.filter(x => x.id !== id)), 4000);
      } catch (e) {
        setUploads(u => u.map(x => x.id === id ? { ...x, status: "error" } : x));
      }
    }
    await refreshKb();
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput(""); setStreaming(true);

    const userMsg = { id: Date.now(), role: "user", content: text };
    setMessages(m => [...m, userMsg]);

    // RAG retrieval
    let docsUsed = 0;
    let contextPrefix = "";
    try {
      const kbParams = activeNs.type === "session"
        ? { question: text, session: activeNs.session, top_k: 5 }
        : { question: text, project: activeNs.project, top_k: 5 };
      const kbRes = await fetch(`${KB}/retrieve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kbParams),
      });
      const kbData = await kbRes.json();
      if (kbData.chunks?.length) {
        docsUsed = kbData.chunks.length;
        contextPrefix = `Use this context:\n\n${kbData.chunks.map(c => `[${c.source}]\n${c.text}`).join("\n\n---\n\n")}\n\nQuestion: `;
      }
    } catch (e) { /* KB unavailable */ }

    const history = messages.filter(m => !m.streaming).map(m => ({ role: m.role, content: m.content }));
    const userContent = contextPrefix ? contextPrefix + text : text;
    const assistantId = Date.now() + 1;
    setMessages(m => [...m, { id: assistantId, role: "assistant", content: "", streaming: true }]);

    try {
      const resp = await fetch(`${ROUTER}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "auto",
          messages: [...history, { role: "user", content: userContent }],
          stream: true,
          "x-strategy": strategy,
        }),
      });

      const tier = resp.headers.get("x-tier-used") || resp.headers.get("x-bifrost-tier") || "auto";
      const latency = resp.headers.get("x-latency-ms") ? parseInt(resp.headers.get("x-latency-ms")) : null;
      const tokS = resp.headers.get("x-tok-s") ? parseFloat(resp.headers.get("x-tok-s")) : null;
      const escalationRaw = resp.headers.get("x-escalation-path");
      const escalation = escalationRaw ? escalationRaw.split(",") : null;

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n").filter(l => l.startsWith("data: "));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content || "";
            fullText += delta;
            setMessages(m => m.map(msg =>
              msg.id === assistantId ? { ...msg, content: fullText } : msg
            ));
          } catch { /* partial chunk */ }
        }
      }

      setMessages(m => m.map(msg =>
        msg.id === assistantId
          ? { ...msg, content: fullText, streaming: false, tier, latency, tokS, escalation, docsUsed }
          : msg
      ));
    } catch (e) {
      setMessages(m => m.map(msg =>
        msg.id === assistantId
          ? { ...msg, content: `Error: ${e.message}`, streaming: false, tier: "error" }
          : msg
      ));
    }
    setStreaming(false);
  }

  const nsLabel = activeNs
    ? activeNs.type === "session" ? `Session: ${activeNs.label}` : `Project: ${activeNs.project}`
    : "No namespace";

  return (
    <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      <ProjectSidebar
        projects={projects} sessions={sessions}
        activeNs={activeNs} setActiveNs={setActiveNs}
        onCreateProject={handleCreateProject} onDeleteProject={handleDeleteProject}
        onCreateSession={handleCreateSession} onDeleteSession={handleDeleteSession}
        uploads={uploads} onDrop={handleDrop}
        collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Session header */}
        <div style={{
          height: 42, borderBottom: `1px solid ${BORD}`,
          display: "flex", alignItems: "center", padding: "0 16px", gap: 12,
          background: SURF, flexShrink: 0,
        }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: TXD }}>
            {nsLabel}
          </div>
          {activeNs?.type === "session" && (
            <div style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: AMB,
              background: `${AMB}15`, border: `1px solid ${AMB}35`,
              borderRadius: 3, padding: "1px 6px",
            }}>ephemeral</div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{
            display: "flex", background: ELEV, borderRadius: 5,
            border: `1px solid ${BORD}`, overflow: "hidden",
          }}>
            {["INTERACTIVE", "AUTOPILOT"].map(s => (
              <button key={s} onClick={() => setStrategy(s)} style={{
                padding: "4px 10px",
                fontFamily: "'JetBrains Mono', monospace", fontSize: 8,
                background: strategy === s ? (s === "AUTOPILOT" ? `${PRP}20` : `${GRN}15`) : "transparent",
                color: strategy === s ? (s === "AUTOPILOT" ? PRP : GRN) : TXM,
                border: "none", cursor: "pointer",
                borderRight: s === "INTERACTIVE" ? `1px solid ${BORD}` : "none",
              }}>{s}</button>
            ))}
          </div>
          <button onClick={() => setMessages([])} style={{
            fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: TXM,
            background: "transparent", border: `1px solid ${BORD}`,
            borderRadius: 4, padding: "3px 8px", cursor: "pointer",
          }}>Clear</button>
        </div>

        {/* Thread */}
        <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
          {messages.length === 0 ? (
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 12, opacity: 0.5,
            }}>
              <div style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 28,
                color: TXM, letterSpacing: "0.1em", fontWeight: 600,
              }}>BIFROST</div>
              <div style={{ fontFamily: "Plus Jakarta Sans, sans-serif", fontSize: 12, color: TXM }}>
                {nsLabel} · {strategy}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {["Summarize the documents", "What are the key findings?", "Draft a response"].map(s => (
                  <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }} style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXD,
                    background: ELEV, border: `1px solid ${BORD}`,
                    borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                  }}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)
          )}
        </div>

        {/* Input bar */}
        <div style={{ borderTop: `1px solid ${BORD}`, padding: "12px 16px", background: SURF, flexShrink: 0 }}>
          <div style={{
            display: "flex", gap: 10, alignItems: "flex-end",
            background: ELEV, border: `1px solid ${streaming ? GRN + "50" : BORDB}`,
            borderRadius: 10, padding: "10px 14px", transition: "border-color 0.2s",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={activeNs ? "Ask anything… Shift+Enter for newline" : "Select a project first"}
              disabled={!activeNs || streaming}
              rows={1}
              style={{
                flex: 1, background: "transparent", border: "none",
                color: TX, fontFamily: "Plus Jakarta Sans, sans-serif",
                fontSize: 13.5, lineHeight: 1.5, resize: "none", outline: "none",
                maxHeight: 120, overflowY: "auto", minHeight: 22,
              }}
              onInput={e => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || !activeNs || streaming}
              style={{
                background: streaming ? "transparent" : `${GRN}25`,
                border: `1px solid ${streaming ? TXM : GRN + "60"}`,
                borderRadius: 7, color: streaming ? TXM : GRN,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                padding: "6px 14px", cursor: streaming ? "not-allowed" : "pointer",
                flexShrink: 0, transition: "all 0.15s",
              }}
            >{streaming ? "…" : "Send"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// STUB SURFACES
// ═══════════════════════════════════════════════════════════
function StubSurface({ name, desc }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: TXD, letterSpacing: "0.05em" }}>{name}</div>
      <div style={{ fontSize: 11, color: TXM, fontFamily: "Plus Jakarta Sans, sans-serif" }}>{desc}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════
export default function BifrostPortal() {
  const [surface, setSurface] = useState("Observe");
  const [status,  setStatus]  = useState(null);
  const [mockOverride, setMockOverride] = useState(MOCK);
  const [metrics, setMetrics] = useState(null);
  const [tick,    setTick]    = useState(0); // force re-render timestamp

  const poll = useCallback(async () => {
    const [s, m, a] = await Promise.all([fetchStatus(), fetchMetrics(), fetchArbiter()]);
    setStatus({ ...s, arbiter: a });
    setMetrics(m);
    setTick(Date.now());
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${BG}; }
        ::-webkit-scrollbar-thumb { background: ${BORD}; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: ${BORDB}; }
        button { background: none; border: none; cursor: pointer; }
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.35; }
        }
      `}</style>

      <div style={{
        height: "100vh", background: BG, color: TX,
        display: "flex", flexDirection: "column",
        fontFamily: "Plus Jakarta Sans, sans-serif",
        overflowX: "hidden",
      }}>
        <TopNav status={status} surface={surface} setSurface={setSurface} mockOverride={mockOverride} setMockOverride={setMockOverride} />

        <div style={{ display: surface === "Observe"  ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}><ObserveSurface status={status} metrics={metrics} /></div>
        <div style={{ display: surface === "Converse" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}><ConverseSurface status={status} /></div>
        <div style={{ display: surface === "Command"  ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: 0, overflow: "hidden" }}><StubSurface name="Command" desc="Session 3 — AUTOPILOT launcher, profiles, slash commands" /></div>

        {/* Status bar */}
        <div style={{
          height: 24, borderTop: `1px solid ${BORD}`,
          display: "flex", alignItems: "center",
          padding: "0 16px", gap: 16, background: SURF, flexShrink: 0,
        }}>
          <PulseDot alive={!!status} size={5} />
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM }}>
            {tick ? `Last poll ${new Date(tick).toLocaleTimeString()}` : "Polling…"}
          </span>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8.5, color: TXM, marginLeft: "auto" }}>
            BIFROST Portal v0.1 · {mockOverride ? "mock data" : `${BROADCASTER}`}
          </span>
        </div>
      </div>
    </>
  );
}
















