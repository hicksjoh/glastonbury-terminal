# Feature DAG — Glastonbury Terminal build plan

18 features + 3 security fixes + 1 data fix, organized by dependency wave.

Agents launch the moment their dependencies are green. Not on a fixed week schedule.

## Wave 0 — Foundation (blocking everything else)

| ID | Feature | Deps | Owner | Est |
|----|---------|------|-------|-----|
| S1 | Replace SHA-256 cookie with JWT sessions | — | Builder | 1d |
| S2 | Install Sentry error tracking | — | Builder | 0.5d |
| S3 | Healthchecks.io pings on all 6 cron routes | — | Builder | 0.5d |
| D1 | Fix FMP `/stable` endpoint error state | — | Builder | 0.5d |
| P1 | Build shared primitives (API client wrapper, Widget kit, prompt library) | — | Builder | 2d |

**Gate to Wave 1:** All of S1, S2, S3, D1, P1 must merge before Wave 1 starts.

## Wave 1 — High-leverage foundation

| ID | Feature | Deps | Owner | Est |
|----|---------|------|-------|-----|
| F1 | MCP server exposing Terminal to Claude.app | P1 | Builder | 3d |
| F14 | Cross-agent shared memory (Supabase table) | P1 | Builder | 1d |
| F15 | ⌘K command palette | P1 | Builder | 1d |
| F10 | 6:30 AM briefing push (no voice) | S3, D1 | Builder | 0.5d |

## Wave 2 — Alt-data brain (runs parallel with Wave 1 tail)

All depend on P1 (shared API client):

| ID | Feature | Deps | Owner | Est |
|----|---------|------|-------|-----|
| F5 | Free options flow (Polygon + Quiver) | P1 | Builder | 1d |
| F6 | 13F whale mirror via SEC EDGAR | P1 | Builder | 3d |
| F7 | AI Fed hawkish/dovish sentiment scorer | P1 | Builder | 2d |
| F8 | Polymarket + Kalshi event odds overlay | P1 | Builder | 1d |
| F9 | Satellite/shipping alt-data (free AIS) | P1 | Builder | 3d (risky-free) |

## Wave 3 — Empire / Hedge (critical financial logic, Agent Team)

| ID | Feature | Deps | Owner | Est |
|----|---------|------|-------|-----|
| F2 | RSU concentration hedge agent | P1, F5 | **Agent Team** (Bull+Bear+Builder) | 4d |
| F3 | Empire ⇄ Markets correlation view | P1, F14 | Builder | 2d |
| F4 | Franchise DCF + Miami Shores AVM | P1 | Builder | 3d |

## Wave 4 — Agents + polish

| ID | Feature | Deps | Owner | Est |
|----|---------|------|-------|-----|
| F11 | Debate-agent trade approval gate | F14 | **Agent Team** | 2d |
| F12 | Wash-sale + PDT guard on orders | — | Builder | 2d |
| F13 | Weekly Sunday auto-email report | F14 | Builder | 1d |
| F16 | Ticker strip top-bar | P1 | Builder | 1d |
| F17 | Public shareable read-only dashboards | S1 | Builder | 2d |
| F18 | PWA + iOS install manifest | — | Builder | 1.5d |

## Critical path

```
S1 → F1 (MCP)          ┐
S2 → F17 (shareable)   │
P1 → F2 (RSU hedge)    ├── ~13 days critical path
F14 → F11 (debate)     │
F14 → F13 (weekly)     ┘
```

Parallel builders can compress calendar time to ~10 working days (~2 weeks).

## Current wave pointer

**Active:** Wave 0 (not started)
**Next:** Wave 1 (unlocks after Wave 0 fully green)

Update this pointer as waves complete.
