# Haadar MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first verifiable Haadar slice from a scheduled 90-minute discovery round to persisted, observable, idempotent discovery work while preserving Free-First operation.

**Architecture:** A thin Cron coordinator creates one logical round per deterministic slot, snapshots the Query Portfolio, applies Budget Guard admission, and sends bounded discovery tasks to one Queue. Queue consumers call source/ATS adapters, persist normalized observations in D1 before downstream decisions, and emit structured operational events. Early Signal, selective Workflows, heuristic scoring, Workers AI, and notifications are added only after this slice is proven.

**Tech Stack:** Cloudflare Workers, Cron Triggers, Queues, D1, Workflows (later selective use), Workers AI (optional later), TypeScript, Wrangler, Vitest, Miniflare-compatible local test bindings.

## Global Constraints

- The owned runtime and durable application state remain 100% Cloudflare; external sources and notification destinations are outbound integrations only.
- The MVP must operate within Workers Free allowances and must not require paid infrastructure.
- A discovery cadence is 16 logical rounds per UTC day, represented by two validated Cron schedules.
- The backend remains frontend-free.
- Persist normalized evidence before relevance scoring, enrichment, or alert selection.
- Every task and side effect has a deterministic idempotency key.
- Workers AI is optional and cannot block collection, persistence, deduplication, Budget Guard, or basic alerting.
- KV, Durable Objects, R2, Vectorize, and AI Gateway are not dependencies of the MVP.
- Query families are `BROAD`, `ROLE`, `STACK`, `CONTEXT`, `COMPANY`, and `EXPERIMENTAL`; stack terms are evidence, not a mandatory discovery gate.
- Budget Guard states are `NORMAL`, `CONSERVATIVE`, `ESSENTIAL`, and `EMERGENCY`.
- The Job Finder remains a comparison baseline, not a runtime dependency.

---

## Implementation sequence

### Task 1: Bootstrap the Worker and test harness

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `src/index.ts`
- Create: `tests/smoke.test.ts`
- Create: `.gitignore`

**Interfaces:**
- Produces a Worker `fetch(request, env, ctx)` entry point and a `scheduled(controller, env, ctx)` entry point.
- Produces a test command that runs without a Cloudflare account.

- [x] **Step 1: Add the minimal package and scripts**

```json
{
  "name": "haadar",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "latest",
    "typescript": "latest",
    "vitest": "latest",
    "wrangler": "latest"
  }
}
```

- [x] **Step 2: Add a smoke test for the health response**

```ts
import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("health endpoint", () => {
  it("returns a non-secret readiness response", async () => {
    const response = await worker.fetch(new Request("https://haadar.local/health"), {} as never, {} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "haadar", status: "ok" });
  });
});
```

- [x] **Step 3: Implement only the health endpoint and empty scheduled handler**

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ service: "haadar", status: "ok" });
    }
    return new Response("Not found", { status: 404 });
  },
  async scheduled(): Promise<void> {}
};
```

- [x] **Step 4: Run verification**

Run: `npm install; npm run typecheck; npm test`

Expected: typecheck succeeds and the smoke test passes.

- [x] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json wrangler.toml src/index.ts tests/smoke.test.ts .gitignore
git commit -m "chore: bootstrap Cloudflare Workers project"
```

### Task 2: Define domain types, identifiers, and configuration

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/ids.ts`
- Create: `src/config.ts`
- Create: `tests/domain/ids.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- `RoundSlot`, `DiscoveryRound`, `DiscoveryTask`, `QueryDefinition`, `NormalizedObservation`, and `BudgetState` are exported domain types.
- `roundSlotFor(scheduledAt: Date): string` returns a UTC slot key.
- `idempotencyKey(parts: string[]): Promise<string>` returns a stable SHA-256 hex key using the Workers Web Crypto API.

- [x] **Step 1: Write tests for slot and idempotency determinism**

```ts
import { describe, expect, it } from "vitest";
import { idempotencyKey, roundSlotFor } from "../../src/domain/ids";

describe("domain identifiers", () => {
  it("normalizes the same scheduled instant to one UTC slot", () => {
    expect(roundSlotFor(new Date("2026-09-30T01:30:00.000Z"))).toBe("2026-09-30T01:30Z");
  });

  it("returns the same key for the same ordered parts", () => {
    expect(idempotencyKey(["round", "2026-09-30T01:30Z", "query-1"]))
      .toBe(idempotencyKey(["round", "2026-09-30T01:30Z", "query-1"]));
  });
});
```

- [x] **Step 2: Implement the identifiers using Web Crypto SHA-256**

The implementation must join parts with `\u001f`, encode UTF-8 with `TextEncoder`, digest with `crypto.subtle.digest("SHA-256", bytes)`, and return lowercase hexadecimal.

- [x] **Step 3: Add explicit Free-First configuration**

Define internal daily ceilings for Workers requests, Queue operations, D1 rows read/written, Workflow steps, and Workers AI neurons. Keep the values in one typed object and reserve 20% for retries/control-plane work.

- [x] **Step 4: Run verification and commit**

Run: `npm run typecheck; npm test`

Expected: all tests pass.

```bash
git add src/domain src/config.ts src/index.ts tests/domain
git commit -m "feat: define Haadar discovery domain contracts"
```

### Task 3: Add D1 migrations for rounds, tasks, observations, and events

**Files:**
- Create: `migrations/0001_initial.sql`
- Create: `src/storage/d1.ts`
- Create: `tests/storage/d1.test.ts`
- Modify: `wrangler.toml`

**Interfaces:**
- `createOrGetRound(db, round)` uses a unique `round_slot`.
- `createTaskIfAbsent(db, task)` uses a unique task idempotency key.
- `insertObservationFirst(db, observation)` persists normalized evidence before decisions.
- `recordOperationalEvent(db, event)` stores bounded structured diagnostics.

- [ ] **Step 1: Write migration-level tests for uniqueness and persist-first ordering**

The test must insert the same round twice and assert one row, insert the same task twice and assert one row, then insert an observation and assert its `persisted_at` exists before any decision row is accepted.

- [ ] **Step 2: Create the schema**

The migration must include indexed tables `discovery_rounds`, `discovery_tasks`, `observations`, `decisions`, and `operational_events`; unique keys for `round_slot`, task idempotency, source identity/canonical URL/fingerprint, and alert outbox idempotency; and UTC timestamps stored as ISO text.

- [ ] **Step 3: Implement parameterized D1 repository functions**

Every query must bind values, select only needed columns, and return typed results. No repository function may scan an unbounded table for a hot-path lookup.

- [ ] **Step 4: Run local D1 verification and commit**

Run: `npm run typecheck; npm test`

Expected: migration and repository tests pass with a local SQLite-backed D1 binding.

```bash
git add migrations src/storage tests/storage wrangler.toml
git commit -m "feat: persist discovery rounds and observations in D1"
```

### Task 4: Implement the 90-minute round coordinator and Budget Guard

**Files:**
- Create: `src/discovery/round-coordinator.ts`
- Create: `src/budget/budget-guard.ts`
- Create: `tests/discovery/round-coordinator.test.ts`
- Create: `tests/budget/budget-guard.test.ts`
- Modify: `src/index.ts`
- Modify: `wrangler.toml`

**Interfaces:**
- `admitRound(input): Promise<RoundAdmission>` creates or reuses one logical round.
- `budgetState(usage, ceilings): BudgetState` returns `NORMAL`, `CONSERVATIVE`, `ESSENTIAL`, or `EMERGENCY`.
- `scheduled(controller, env, ctx)` calls the coordinator with the scheduled time and does not perform source fetching.

- [ ] **Step 1: Test duplicate scheduled invocation**

Two invocations with the same scheduled instant must return the same `round_id`, create one round, and enqueue no duplicate task identities.

- [ ] **Step 2: Test Budget Guard transitions**

Assert that usage below 70% is `NORMAL`, usage from 70% through 85% is `CONSERVATIVE`, usage at or above 85% is `ESSENTIAL`, and usage at the configured emergency ceiling produces `EMERGENCY` with nonessential admission disabled.

- [ ] **Step 3: Implement coordinator admission**

The coordinator must snapshot the active Query Portfolio revision, record the budget state, create the round transactionally, and produce bounded task messages only for admitted query/adapter pairs.

- [ ] **Step 4: Validate the two Cron expressions against Wrangler documentation**

Configure the two expressions that represent the 90-minute UTC cadence, run `wrangler deploy --dry-run`, and record the accepted expressions in `wrangler.toml` comments and the test fixture.

- [ ] **Step 5: Run tests and commit**

```bash
npm run typecheck
npm test
git add src/discovery src/budget tests/discovery tests/budget src/index.ts wrangler.toml
git commit -m "feat: add scheduled discovery rounds"
```

### Task 5: Add Query Portfolio and adapter contracts

**Files:**
- Create: `src/portfolio/query-portfolio.ts`
- Create: `src/adapters/adapter.ts`
- Create: `src/adapters/fixtures.ts`
- Create: `tests/portfolio/query-portfolio.test.ts`
- Create: `tests/adapters/adapter-contract.test.ts`

**Interfaces:**
- `QueryPortfolio.activeRevision()` returns an immutable revision.
- `QueryPortfolio.admit(state)` returns prioritized query/adapter tasks.
- `SourceAdapter.discover(task): Promise<AdapterResult>` returns normalized observations and diagnostics.

- [ ] **Step 1: Test family filtering and priority ordering**

The test fixture must include one query from each family and assert that disabled, cooled-down, and budget-rejected queries are excluded while priority order is stable.

- [ ] **Step 2: Define the adapter contract and failure taxonomy**

The result type must distinguish `retryable`, `permanent`, `throttled`, `blocked`, and `schema_changed` failures and must carry source identity, query identity, and observed time.

- [ ] **Step 3: Implement a deterministic fixture adapter**

The fixture adapter returns two observations, one duplicate, and one retryable diagnostic so queue and persistence behavior can be tested without calling a real source.

- [ ] **Step 4: Run tests and commit**

```bash
npm run typecheck
npm test
git add src/portfolio src/adapters tests/portfolio tests/adapters
git commit -m "feat: define query portfolio and adapter contracts"
```

### Task 6: Add Queue distribution, consumer retry boundaries, and persist-first normalization

**Files:**
- Create: `src/queue/messages.ts`
- Create: `src/queue/consumer.ts`
- Create: `tests/queue/consumer.test.ts`
- Modify: `src/index.ts`
- Modify: `wrangler.toml`

**Interfaces:**
- `DiscoveryTaskMessage` contains `roundId`, `queryId`, `adapterId`, `idempotencyKey`, and `attempt`.
- `consume(batch, env)` invokes the adapter, persists every normalized observation before classification, records diagnostics, and acknowledges only handled messages.

- [ ] **Step 1: Test duplicate queue delivery**

Deliver the same message twice and assert one task completion, one observation identity, and one operational completion event.

- [ ] **Step 2: Test retryable and permanent failures**

Retryable failures must remain retryable with bounded attempt metadata; permanent, blocked, and schema-changed failures must become explicit terminal outcomes without blocking other messages.

- [ ] **Step 3: Implement the consumer with bounded batches**

The consumer must use one adapter task per message, enforce response size/time limits, call `insertObservationFirst` before any decision function, and record source diagnostics without secrets.

- [ ] **Step 4: Run focused and full verification**

Run: `npm test -- tests/queue/consumer.test.ts; npm test; npm run typecheck`

Expected: focused tests and the complete suite pass.

- [ ] **Step 5: Commit**

```bash
git add src/queue tests/queue src/index.ts wrangler.toml
git commit -m "feat: distribute discovery tasks through Queue"
```

### Task 7: Implement deterministic gate, deduplication, heuristic scoring, and Final Decision

**Files:**
- Create: `src/decision/deterministic-gate.ts`
- Create: `src/decision/early-signal.ts`
- Create: `src/decision/heuristic-score.ts`
- Create: `src/decision/final-decision.ts`
- Create: `tests/decision/decision-pipeline.test.ts`

**Interfaces:**
- `deterministicGate(observation, portfolio): GateResult`.
- `earlySignal(observation, gate): EarlySignal | null`.
- `heuristicScore(observation, evidence): HeuristicScore`.
- `finalDecision(input): FinalDecision`.

- [ ] **Step 1: Test deterministic rejection and Early Signal admission**

An observation that fails a required exclusion must produce no Early Signal. A new eligible observation must produce one provisional Early Signal with a stable idempotency key.

- [ ] **Step 2: Test the full ordered pipeline**

Assert the order `persisted observation -> deterministic gate -> Early Signal -> enrichment boundary -> heuristic score -> optional AI boundary -> Final Decision` and assert that repeated finalization does not create a duplicate alert.

- [ ] **Step 3: Implement explainable reason codes**

Every gate, score, Early Signal, and Final Decision must include rule version, evidence fields, and a reason code. Unknown publication time must never be converted into a claimed publication timestamp.

- [ ] **Step 4: Run tests and commit**

```bash
npm run typecheck
npm test
git add src/decision tests/decision
git commit -m "feat: add deterministic decisions and early signals"
```

### Task 8: Add selective Workflows, optional Workers AI, and notification outbox

**Files:**
- Create: `src/workflows/enrichment.ts`
- Create: `src/ai/enrichment.ts`
- Create: `src/notifications/outbox.ts`
- Create: `tests/workflows/enrichment.test.ts`
- Create: `tests/ai/enrichment.test.ts`
- Create: `tests/notifications/outbox.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- `runSelectiveEnrichment(input)` is invoked only for candidates that passed the deterministic gate and budget admission.
- `enrichWithAi(input, aiBinding)` returns a validated result or a deterministic fallback.
- `enqueueNotification(input)` uses an outbox idempotency key and returns the existing record on repeat.

- [ ] **Step 1: Test operation with AI unavailable**

The complete candidate path must produce a valid heuristic Final Decision and notification outbox record when the AI binding is absent, throttled, or returns invalid schema.

- [ ] **Step 2: Test Workflow admission**

Budget states `ESSENTIAL` and `EMERGENCY` must not start optional enrichment; `NORMAL` may start it only after the deterministic gate.

- [ ] **Step 3: Implement schema validation, model allowlist, and provenance**

Store model, prompt version, validation result, and fallback reason. Reject unbounded output and never send secrets or full raw source payloads to the model.

- [ ] **Step 4: Test and commit**

```bash
npm run typecheck
npm test
git add src/workflows src/ai src/notifications tests/workflows tests/ai tests/notifications src/index.ts
git commit -m "feat: add selective enrichment and notification outbox"
```

### Task 9: Add operational metrics, retention, and deployment verification

**Files:**
- Create: `src/observability/events.ts`
- Create: `src/observability/usage-ledger.ts`
- Create: `src/maintenance/retention.ts`
- Create: `tests/observability/usage-ledger.test.ts`
- Create: `docs/runbooks/free-tier-operations.md`
- Modify: `README.md`

**Interfaces:**
- `recordUsage(service, day, delta)` is idempotent for a usage event key.
- `summarizeHealth(db, now)` returns latest round, coverage, budget state, adapter failures, queue age, and notification health.
- `runRetention(db, policy)` never deletes evidence required to explain an alert.

- [ ] **Step 1: Test usage ledger and emergency suppression**

Record repeated usage events and assert one accounting effect; exceed the configured ceiling and assert new nonessential admission is suppressed.

- [ ] **Step 2: Implement bounded structured events and health summary**

Include `round_id`, `task_id`, `query_id`, `adapter_id`, `vacancy_id`, and `notification_id` only when applicable. Never log secrets, authorization headers, or unrestricted payloads.

- [ ] **Step 3: Implement retention with alert-evidence protection**

Prune old operational events and obsolete observations according to explicit windows while retaining vacancy identity, first-seen evidence, decision reasons, and notification history.

- [ ] **Step 4: Deploy a controlled preview and validate**

Run `wrangler d1 migrations apply`, `wrangler deploy`, trigger one controlled round, inspect logs, verify one persisted round and one adapter result, and confirm no paid resource is enabled.

- [ ] **Step 5: Update README and commit**

```bash
git add src/observability src/maintenance tests/observability docs/runbooks/free-tier-operations.md README.md
git commit -m "feat: add Haadar observability and budget operations"
```

## Completion checklist

- [ ] SPEC-001 approved and committed.
- [ ] GitHub repository created and `main` pushed.
- [ ] Worker bootstrap and local tests pass.
- [ ] D1 migrations and unique constraints pass locally.
- [ ] Two Cron schedules validated for the 90-minute cadence.
- [ ] Query Portfolio revision is recorded per round.
- [ ] Queue task admission is bounded by Budget Guard.
- [ ] At least one adapter persists normalized evidence before decisions.
- [ ] Duplicate delivery does not duplicate observations or alerts.
- [ ] Early Signal is provisional, fast, explainable, and idempotent.
- [ ] Heuristic scoring and Final Decision work without Workers AI.
- [ ] Selective Workflows are disabled under essential/emergency budget states.
- [ ] Usage ledger, health summary, retention, and runbook are verified.
- [ ] Representative observation remains inside revalidated Workers Free quotas.
- [ ] Each milestone has a focused test result and a separate Git commit.

