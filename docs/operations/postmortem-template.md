# Postmortem — [INCIDENT TITLE]

> Fill out within 24h of the incident closing. Goal: capture facts, not
> assign blame. Future-Wes reading this six months from now should be able
> to understand what happened, why, and what changed afterward.

## Summary

| | |
|---|---|
| **Date** | YYYY-MM-DD |
| **Duration** | HH:MM (start → resolved) |
| **Severity** | SEV-1 / SEV-2 / SEV-3 |
| **Detected by** | (alert / user / smoke test / Wes manually) |
| **Resolved by** | (Wes / auto-recovery / external party) |
| **Author** | Wes |

One paragraph: what was broken, who noticed, what was the user impact.

## Timeline (UTC)

```
HH:MM  — first symptom appeared (e.g. cron silently stopped firing)
HH:MM  — Healthchecks alert fired
HH:MM  — Wes acknowledged
HH:MM  — root cause identified
HH:MM  — fix applied
HH:MM  — verified healthy
```

## What happened

Describe the chain: trigger → propagation → impact. Stay factual. No
"should have" yet.

## Root cause

The single sentence that explains the underlying *why*. Not the proximate
cause (e.g. "the cron failed") but the cause-of-cause (e.g. "the cron's
SQL upsert race-loses against a concurrent write because the unique
constraint we assumed was there isn't there anymore").

## What went well

- Detection was fast because [X]
- The runbook had the right entry for this
- (etc.)

## What went poorly

- Detection was slow because [Y]
- The runbook didn't cover this scenario
- A retry that should have been idempotent wasn't
- (etc.)

## Action items

| # | Action | Owner | Due | Status |
|---|--------|-------|-----|--------|
| 1 | Concrete thing to do | Wes | YYYY-MM-DD | open |
| 2 | Add Playwright test for X | Wes | YYYY-MM-DD | open |
| 3 | Update runbook §[Y] | Wes | YYYY-MM-DD | open |

Every action item must be concrete (not "be more careful") and have a
date. If it's never going to happen, don't write it down.

## Did the SLO budget burn?

Yes / No. If yes, link the SLO row in [docs/observability/slos.md](../observability/slos.md)
and indicate whether deploy freeze applies.
