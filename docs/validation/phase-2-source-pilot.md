# Phase 2 — First Real Source Pilot

**Executed:** 30/09/2026  
**Scope:** local Worker, local Queue, local D1, live public Greenhouse response.  
**Not proved here:** remote Queue delivery, production D1 migration, alert delivery,
24-hour reliability, or relevance of every collected vacancy.

## Procedure

1. Applied migrations `0001` through `0004` to Wrangler's local D1.
2. Started `wrangler dev --test-scheduled` with local Queue and D1 bindings.
3. Triggered one scheduled round.
4. The Worker fetched the configured PlanetScale Greenhouse board once, the
   local Queue consumed one board task, and the adapter attributed jobs to the
   applicable Query Portfolio entries.
5. Queried the local D1 after the Queue completed.

The first trigger before local migrations existed failed with `no such table`.
After applying the tracked migrations, the controlled trigger returned 200 and
the Queue task completed. This confirms the runbook prerequisite rather than
hiding the failed first attempt.

## Evidence

- 12 canonical vacancies persisted with `organization = PlanetScale`.
- 46 real occurrences persisted across local query attribution.
- One board task reached `completed`.
- Example public vacancy observed:
  <https://job-boards.greenhouse.io/planetscale/jobs/4396843009>
- Another verified software vacancy was persisted at:
  <https://job-boards.greenhouse.io/planetscale/jobs/4251150009>
- No notification was sent during this pilot.

The count is a point-in-time observation. The public board can change, so tests
use minimized fixtures and do not assert a permanent live count.
