---
name: spec-writer
description: Turns a feature ID from the DAG into a buildable 1-page spec with routes, tables, UI wireframe, acceptance Playwright test, and Claude prompt outlines. Trigger when orchestrator says "/spec-feature <id>".
allowed-tools: Read, Write, Grep, Glob, WebSearch
---

# Spec-writer skill

You produce ONE file: `docs/build-plan/features/<id>.md`. Format below.

## Output template

```markdown
# <id> — <feature title>

**Owner:** Builder (worktree)
**Status:** spec'd · in-progress · verified · merged
**Dependencies:** <list of other feature ids that must merge first>
**Estimated time:** <0.5-3 days>
**New monthly cost:** $<X> — <vendor>

## Goal
<1-2 sentences. What the user gains.>

## Routes
- `GET /api/<path>` — <purpose, auth, rate-limit>
- `POST /api/<path>` — <purpose, auth, rate-limit>

## Database
<Supabase tables created/modified. Migration file name.>

## UI
- Page: `src/app/<path>/page.tsx`
- Key components: <list>
- Nav group: <which section of the sidebar>

## Claude prompts (if any)
- `src/lib/prompts/<name>.ts` — <purpose, input, output contract>
- Caching strategy: <system prompt cached? tool defs cached?>
- Batch or real-time? <justify>

## Acceptance test (e2e/<id>.spec.ts)
\`\`\`typescript
// Paste a Playwright test stub here with concrete assertions.
// The test must be runnable and fail before implementation.
\`\`\`

## Feature flag
- Flag name: `<id>_enabled`
- Default in prod: off
- How to toggle: `?flag=<id>` in URL, or via admin settings page

## Out of scope
<Things adjacent to this feature that we are NOT doing. Prevents scope creep.>

## References
- Research: <links to external docs, APIs, papers>
- Similar existing code: <paths to repo files that use similar pattern>
```

## Rules

- If a dependency isn't merged yet, list it and stop — don't spec features that can't yet be built.
- Include CONCRETE Playwright assertions, not vague "page loads."
- Estimate time honestly. Round up.
- If the feature requires a paid API, document the cost and check the user's existing keys (grep env-check route).
- Spec files are the contract. Builders read them verbatim. Ambiguity in spec = builder escalates to you.
