# Builder checkpoints

This directory holds per-feature checkpoint files. Every Builder writes to `<feature-id>.md` every 10 meaningful steps during its run.

Format:

```markdown
# <feature-id> — <title>

## Status
spec'd · in-progress · verified · merged · blocked

## Timeline
- Started: 2026-04-20 14:32
- Last checkpoint: 2026-04-20 15:10
- Finished: —

## Progress
- [x] Read spec
- [x] Wrote failing Playwright test
- [x] Implemented GET /api/...
- [ ] Implemented POST /api/...
- [ ] Self-refine pass 1
- [ ] Verifier pass
- [ ] Security pass
- [ ] PR opened

## Files touched
- src/app/api/<path>/route.ts
- src/app/<path>/page.tsx
- src/lib/<name>.ts
- e2e/<id>.spec.ts

## Open questions
- (none) or (list)

## Decisions made
- Chose X over Y because ...

## Verifier verdict
PASS / FAIL — <evidence>

## Security verdict
PASS / FAIL — <evidence>
```

The orchestrator reads these to maintain continuity across sessions. If an agent crashes or hits context limits, the next spawn reads its checkpoint and resumes from the last completed step.
