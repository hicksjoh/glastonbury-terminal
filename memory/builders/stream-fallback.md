# Stream overload fallback — checkpoint

- Helper: `streamWithFallback` in `src/lib/claude.ts` (replaces the unused, equally-dead `streamMessageWithFallback`).
- Call sites moved onto it: keisha/voice, keisha/briefing, crew/analyze (specialist + judge), debate-engine (debater + moderator), earnings/live chat, keisha/agent (opening turn only).
- Tests: `src/lib/__tests__/stream-fallback.test.ts` (incl. one through the real SDK stream with a fake fetch), plus an "overload fallback" block in `src/lib/keisha/__tests__/agent.test.ts`.
- Open question: keisha/agent only falls back on iteration 0. Falling back after a tool round-trip needs a decision on replaying another model's thinking/tool_use blocks.
- Not covered: route-level SSE tests for the `model` event ordering (helper-level test only).
