# DR Drill Log

Quarterly disaster-recovery drills per [dr-procedures.md](dr-procedures.md).
This log captures each drill's date, scope, time-to-recover, and surprises
so future drills target the slowest paths.

The point isn't perfection — it's exposure. Run the drill, write down what
took longer than expected, fix that thing, run again next quarter.

## Cadence

Last Friday of each calendar quarter:
- **Q1:** late March
- **Q2:** late June
- **Q3:** late September
- **Q4:** late December

If a quarter is skipped, skip it — don't try to "make up." The drill is
forward-looking, not retrospective.

## Drill format

Each drill picks ONE scenario from `dr-procedures.md`. Don't try to drill
all four in one session — fatigue + incomplete recovery + mixed signal.
Single scenario, full execution, written debrief.

Rotate scenarios across quarters so all four get exercised within the year:

| Quarter | Default scenario |
|---------|-----------------|
| Q1      | Vercel deploy rollback |
| Q2      | Supabase PITR restore (in test project — never prod) |
| Q3      | Anthropic key rotation |
| Q4      | Source repo / GitHub access recovery (theoretical walkthrough) |

## Template — fill out for each drill

```
### [YYYY-MM-DD] Drill — [scenario]

Operator:    Wes
Scope:       (one sentence — what was simulated)
Start:       HH:MM (local)
End:         HH:MM
Duration:    M minutes
Target RTO:  (from dr-procedures.md)

Steps executed:
1. (timestamp) action
2. (timestamp) action
...

What worked smoothly:
- ...

What surprised me / took longer than expected:
- ...

Action items:
| # | Item | Owner | Due |
|---|------|-------|-----|
| 1 | ...  | Wes   | YYYY-MM-DD |
```

## Past drills

_No drills run yet. First drill: late June 2026 — Supabase PITR restore in
a fresh test project._

## Why drill at all

Three things go wrong with disaster recovery, and only drilling reveals them:

1. **Tooling rot.** The Vercel CLI updates, the Supabase dashboard
   reorganizes, an env var was renamed two months ago. The runbook gets
   stale faster than you'd guess.

2. **Forgotten access.** "Oh right, the recovery email goes to the
   account I closed last year." The drill catches account-recovery,
   2FA-token, and credential-vault issues before they matter.

3. **Wall-clock overrun.** The runbook says 30 minutes; the actual restore
   takes 2 hours because of a step nobody mentioned. The drill turns the
   estimate into evidence.

After three drills you should be able to do the scenario from cold start
in under target RTO without consulting the runbook. That's "drilled."
