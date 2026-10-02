# Source Adapter Contracts and Canaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Haadar source declare a bounded public-fetch contract and make each successful collection produce an auditable, low-cost health canary with a historical volume baseline.

**Architecture:** Source definitions remain the single portfolio registry. A pure contract validator rejects unsafe or incomplete definitions at startup and in tests. Each normal bounded collection doubles as the canary: it writes a source-health sample, compares its observation count with recent successful samples, and emits an operational event without adding a network request or opening a circuit for a volume anomaly.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vitest, Miniflare.

**Spec:** `docs/specs/SPEC-001-haadar-architecture-and-engineering-constraints.md`

## Global Constraints

- Preserve the backend-only, 100% Cloudflare, Free Tier-first architecture.
- Every configured source remains public and bounded to one request per task.
- A canary must reuse the normal collection result; it must never introduce an additional upstream request.
- Volume anomalies are observational only; they must not pause a source or alter alert delivery.
- Source health circuits continue to pause terminal/throttled upstream failures only.
- Operational payloads must not persist response bodies, URLs, credentials, or free-text error details; a validated configured `sourceKey` is permitted solely to group shared upstream health.

## Review Focus

- A legitimate zero-result collection must warm a new baseline without being treated as a terminal failure.
- A retry or duplicate Queue delivery must not create duplicate health samples or canary events.
- Shared upstream health keys must aggregate their historical samples without hiding the task's own adapter identity in events.
- Invalid portfolio definitions must fail before discovery tasks are published.
- Health-sample retention must remain bounded independently of decision/audit evidence.

---

### Task 1: Source contract registry and validation

**Files:**
- Create: `src/portfolio/source-contract.ts`
- Modify: `src/portfolio/sources.ts`
- Modify: `tests/portfolio/sources.test.ts`
- Create: `tests/portfolio/source-contract.test.ts`

**Interfaces:**
- Produces `validateSourceContract(source: SourceDefinition): void` and `validateSourceContracts(sources: SourceDefinition[]): void`.
- Produces `SourceCanaryPolicy` on each `SourceDefinitionBase` with a positive `minimumBaselineSamples`, `baselineWindow`, and non-negative `anomalyAtOrBelow`.

- [ ] **Step 1: Write failing contract tests**

Test that every `pilotSource` validates, and that an empty host list, a non-board-once fetch strategy, more than one request, or an invalid canary policy throws a clear `RangeError`.

- [ ] **Step 2: Run the focused contract tests and confirm they fail**

Run: `npm test -- --run tests/portfolio/source-contract.test.ts`

- [ ] **Step 3: Implement the contract registry and annotate portfolio definitions**

Define adapter kinds and public contract requirements in `source-contract.ts`; add a shared low-cost canary policy to source definitions; validate `pilotSources` at module initialization.

- [ ] **Step 4: Run the focused tests and portfolio tests**

Run: `npm test -- --run tests/portfolio/source-contract.test.ts tests/portfolio/sources.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/portfolio tests/portfolio
git commit -m "feat: define validated source adapter contracts"
```

### Task 2: Persisted canary samples and baseline evaluator

**Files:**
- Create: `migrations/0012_source_canary_samples.sql`
- Create: `src/storage/source-canary.ts`
- Create: `tests/storage/source-canary.test.ts`
- Modify: `src/maintenance/retention.ts`
- Modify: `tests/integration/operational-health.test.ts`

**Interfaces:**
- Produces `recordSourceCanary(db, input): Promise<SourceCanaryResult>`.
- `SourceCanaryResult` contains `state: "warming" | "healthy" | "anomalous"`, `observedCount`, `baselineMedian`, and `sampleSize`.
- The sample identity is the discovery task ID, so a repeat delivery overwrites rather than duplicates a sample.

- [ ] **Step 1: Write failing evaluator and retention tests**

Test warm-up with fewer than the required samples, healthy counts near the median, a zero-count anomaly after a positive baseline, idempotent task writes, and deletion of expired samples.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run: `npm test -- --run tests/storage/source-canary.test.ts tests/integration/operational-health.test.ts`

- [ ] **Step 3: Add D1 storage and deterministic median evaluation**

Store source key, task ID, round ID, observation count, and timestamp. Query only the configured baseline window before recording the current sample. Retain samples for the same bounded maintenance period as operational events.

- [ ] **Step 4: Run focused storage and retention tests**

Run: `npm test -- --run tests/storage/source-canary.test.ts tests/integration/operational-health.test.ts`

- [ ] **Step 5: Commit**

```bash
git add migrations src/storage src/maintenance tests/storage tests/integration
git commit -m "feat: persist source canary baselines"
```

### Task 3: Queue canary events and operational summary

**Files:**
- Modify: `src/queue/consumer.ts`
- Modify: `src/observability/health.ts`
- Modify: `tests/integration/queue.test.ts`
- Modify: `tests/integration/operational-health.test.ts`

**Interfaces:**
- Each completed source task records one atomic sample-and-event canary snapshot using `sourceHealthKey ?? task.adapterId`; if D1 is unavailable, preserve the core completed task without retrying the upstream source and leave no partial or stale canary evidence.
- Emit `source_canary` operational events with only `sourceKey`, `state`, `count`, and numeric baseline metadata.
- Add `anomalousSources` to `OperationalHealthSummary` as the number of distinct source keys with an anomalous canary in the last 24 hours.

- [ ] **Step 1: Write failing queue and health-summary tests**

Test that a completed task records one sample/event, that a zero count after a positive baseline emits `anomalous` without pausing the source, and that the health endpoint counts anomalous sources separately from failing adapters.

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `npm test -- --run tests/integration/queue.test.ts tests/integration/operational-health.test.ts`

- [ ] **Step 3: Integrate canary recording after a successful task completion**

Call the evaluator only after all diagnostics are clear and before returning the completed outcome. Persist its sample and sanitized event as one task-keyed D1 snapshot. Preserve the current terminal/throttle circuit behavior; on D1 observability failure, log only a constant event name and complete the source task without leaving a partial snapshot.

- [ ] **Step 4: Run focused tests, typecheck, and full test suite**

Run: `npm run check`

- [ ] **Step 5: Commit**

```bash
git add src/queue src/observability tests/integration
git commit -m "feat: surface source canary anomalies"
```

## Self-Review

- Contract validation, canary persistence, baseline evaluation, runtime emission, retention, and observability each map to one task.
- No task adds a network call, source, browser, proxy, or paid Cloudflare product.
- Queue idempotency is anchored to the task ID and covered by Task 2 and Task 3.
- Volume anomalies remain informational and separately visible from circuit-breaking failures.
