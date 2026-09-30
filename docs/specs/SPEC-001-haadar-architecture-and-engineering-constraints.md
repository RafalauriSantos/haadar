# SPEC-001 — Haadar Architecture & Engineering Constraints

> Amendment 30/09/2026: the approved cadence is hourly. Earlier 90-minute
> references are superseded by this decision.

- **Status:** Approved by user
- **Date:** 2026-09-30
- **Decision type:** Foundational architecture
- **Scope:** MVP architecture and engineering constraints only
- **Implementation status:** Not started

## 1. Purpose

Haadar is a backend-only job discovery system that searches a controlled portfolio of queries every hour, captures job evidence from multiple sources, identifies new or unusually early opportunities, and emits useful alerts without requiring paid infrastructure.

Its primary outcome is not “collect as many vacancies as possible.” It is to discover relevant opportunities early, reproducibly, and within a fixed free-tier budget. The system must make it possible to explain where a vacancy came from, when it was first observed, how it was classified, why it was or was not alerted, and which resources the decision consumed.

The MVP is successful when it can run continuously, tolerate duplicate delivery and partial source failure, preserve evidence before decision-making, and degrade safely before any Cloudflare Free Tier quota is exhausted.

## 2. Scope

### 2.1 In scope

- Scheduled discovery rounds every hour.
- A versioned Query Portfolio.
- Source- and ATS-specific adapters.
- Normalization into a canonical vacancy observation.
- Persistence-first processing in D1.
- Deterministic deduplication and idempotent retries.
- Deterministic eligibility rules and Early Signal scoring.
- Asynchronous work distribution through Queues.
- Selective use of Workflows for genuinely multi-step, durable operations.
- Optional Workers AI enrichment after deterministic filtering.
- Budget protection and operational observability.
- Backend notification delivery through one or more outbound channels.

### 2.2 Out of scope for the MVP

- A web or mobile frontend.
- User accounts, teams, subscriptions, or multi-tenancy.
- A general-purpose scraping platform.
- Automated job application.
- Paid Cloudflare capacity or infrastructure hosted outside Cloudflare.
- KV, Durable Objects, R2, Vectorize, and AI Gateway.

These exclusions are architectural decisions for the MVP, not claims that the products have no value. They may be reconsidered only through a later specification supported by a measured need.

## 3. Non-negotiable constraints

### 3.1 100% Cloudflare runtime

All application compute, scheduling, asynchronous coordination, durable application state, and optional model inference must run on Cloudflare services:

- Workers for runtime and HTTP/queue/scheduled handlers;
- Cron Triggers for scheduling;
- Queues for asynchronous distribution and retry boundaries;
- D1 for durable application data;
- Workflows for selected durable multi-step processes;
- Workers AI only when deterministic logic is insufficient.

“100% Cloudflare” applies to Haadar's owned runtime and state. Job sources and notification destinations are necessarily external systems reached through outbound HTTP; they must not host Haadar logic or become an untracked database.

### 3.2 100% Free Tier operation

The MVP must not depend on usage that incurs a charge. A quota breach must result in deferred or reduced work, never an automatic paid overage.

The implementation must:

1. read all operative thresholds from configuration;
2. maintain internal daily usage counters and conservative estimates;
3. reserve capacity for retries and control-plane work;
4. disable optional work before essential work;
5. stop admitting new discovery tasks before a hard platform limit;
6. expose every budget-based suppression as an observable event;
7. require a new architectural decision before enabling any paid plan or billing-dependent model.

Cloudflare quotas are external constraints and may change. The values below are the verified baseline on 2026-09-30 and must be revalidated before deployment:

| Service | Verified Free baseline | Haadar design implication |
|---|---:|---|
| Workers | 100,000 requests/day; 10 ms CPU per invocation; 50 subrequests/invocation; 5 Cron Triggers/account | Keep handlers thin, split work through queues, and use only two cron schedules. |
| Queues | 10,000 operations/day; 24-hour retention | Budget approximately three operations per normally delivered message and leave retry headroom. |
| D1 | 5 million rows read/day; 100,000 rows written/day; 500 MB/database; 5 GB/account | Index all hot lookups, avoid scans, batch writes, and apply retention. |
| Workflows | 3,000 steps/day; 1 GB-month state; requests shared with Workers | Use only for selected durable sequences, never for every record by default. |
| Workers AI | 10,000 neurons/day free allocation; some models require a paid plan | Keep AI optional, model-allowlisted, and below a configurable daily ceiling. |

Design budgets must initially cap optional work at no more than 80% of a verified platform allowance. This is a safety ceiling, not a target.

Official baseline sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/), and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

### 3.3 Backend-only MVP

The system has no frontend dependency. Its usable outputs are outbound alerts and operational data accessible through logs and tightly scoped administrative endpoints or tooling. A dashboard is not required to validate the product hypothesis.

## 4. Architecture decision

### 4.1 Logical view

```text
Cron (one hourly schedule)
  -> Discovery Round Coordinator (Worker)
  -> D1: persist round and immutable query/adaptor plan
  -> Queue: bounded discovery tasks
  -> Source/ATS Adapters (Worker consumers)
  -> D1: persist normalized observations first
  -> Deduplication + Deterministic Gate
  -> optional Early Signal alert
  -> selective Workflow for durable enrichment/alert sequences
  -> Enrichment + heuristic scoring
  -> optional Workers AI
  -> Final Decision + D1 outbox record
  -> notification channel

All stages -> structured operational events + budget counters in D1/logs
```

### 4.2 Scheduling every hour

A discovery round is due 24 times per UTC day. Cloudflare Cron Triggers express the hourly cadence with one UTC schedule:

- at minute 0 of every hour: `0 * * * *`.

The implementation plan must validate the exact Cloudflare cron expressions before bootstrap. Scheduling is at-least-once from Haadar's perspective: the coordinator derives a deterministic `round_slot` from the scheduled time, and a unique constraint ensures that duplicate invocations reuse the same round instead of creating duplicate work.

A delayed invocation may process its own slot if still inside the configured staleness window. It must not generate an unbounded catch-up storm.

### 4.3 Component boundaries

#### Discovery Round Coordinator

Creates or reuses the round, snapshots the active Query Portfolio version, evaluates the Budget Guard, and enqueues only the bounded tasks admitted for that round. It does not fetch vacancy pages or perform AI inference.

#### Query Portfolio

A versioned set of search intents. Each query definition contains at least:

- stable identifier and revision;
- search terms and optional exclusions;
- target role/stack/seniority intent;
- geography and remote policy;
- applicable sources/adapters;
- priority and estimated cost;
- minimum interval and cooldown;
- active state;
- provenance explaining why the query exists.

The portfolio is scheduled, not blindly replayed. Query families include `BROAD`, `ROLE`, `STACK`, `CONTEXT`, `COMPANY`, and `EXPERIMENTAL`. Stack terms are evidence for relevance, not a mandatory discovery entry point. Higher-value or under-sampled queries receive priority, while repeatedly low-yield queries can be cooled down. A round stores the exact portfolio revision and admitted tasks so results remain explainable after configuration changes. Each query is measurable through the funnel `jobs_found -> unique_jobs -> relevant_jobs -> alerts -> applications`.

#### Source/ATS adapters

Each external source or ATS is isolated behind a common contract:

- accept a normalized discovery task;
- construct only allowed requests;
- return observations plus adapter diagnostics;
- classify failures as retryable, permanent, throttled, blocked, or schema-changed;
- never write directly to notification channels;
- never embed source-specific fields into the domain core.

Adapters must honor source terms, access controls, and rate limits. Public APIs or stable public job endpoints are preferred. A blocked or prohibited source is disabled rather than bypassed.

#### Normalization and persistence

Adapters produce a canonical observation containing source identity, source vacancy identifier when available, canonical URL, title, organization, location, work model, description summary or permitted text, publication time when explicitly provided, observed time, query provenance, and a content fingerprint.

“Persist-first” means the normalized observation and its provenance are durably recorded before relevance scoring, AI enrichment, or alert selection. Haadar does not need to store full HTML pages in the MVP; D1 stores the minimum permitted evidence needed for replay and explanation.

#### Deduplication and idempotency

Deduplication uses layered deterministic keys:

1. source plus stable source vacancy identifier, when available;
2. normalized canonical URL;
3. a versioned fingerprint derived from stable normalized fields.

Cross-source similarity may mark likely duplicates, but it must not silently merge records without auditable evidence. Every queue message carries an idempotency key. Unique constraints and transactional state transitions make repeated scheduling, redelivery, and retries safe. Sending an alert uses an outbox idempotency key so a successful notification is not intentionally repeated.

#### Early Signal

Early Signal is a provisional, fast alert for a vacancy that survives the first deterministic gate. It may be emitted during the current round, before the complete batch finishes, so a promising opportunity is not held behind expensive processing. It is deterministic in the MVP and uses only known evidence:

- explicit source publication time, when trustworthy;
- `first_seen_at` recorded by Haadar;
- whether the observation is new to Haadar;
- source freshness characteristics;
- query priority and deterministic eligibility;
- confidence in timestamp and identity evidence.

The system must distinguish “recently published” from “recently discovered.” If a source does not provide a trustworthy publication timestamp, Haadar may claim only that the vacancy is newly observed. Missing data must reduce confidence, not be invented. An Early Signal carries provisional status and an idempotency key; later enrichment and heuristic scoring produce a Final Decision without creating an unintended duplicate alert.

#### Budget Guard

The Budget Guard makes an admission decision before work is enqueued and again before optional stages. It tracks or conservatively estimates Workers requests, Queue operations, D1 reads/writes/storage, Workflow steps/storage, AI neurons, outbound requests, per-source rate limits, and retry reserve.

Operating states:

- **NORMAL (<70% of the internal daily budget):** normal bounded operation.
- **CONSERVATIVE (70–85%):** reduce experimental queries, concurrency, and optional enrichment.
- **ESSENTIAL (>=85%):** stop AI and optional Workflows; admit only essential retries and high-priority discovery if reserve permits.
- **EMERGENCY (configured below the platform limit):** create explicit skipped/deferred outcomes and admit no new nonessential work.

Daily counters follow the relevant provider reset boundary, normally 00:00 UTC. Estimation errors must fail conservative.

#### Selective Workflows

Workflows are justified only when an operation needs durable multi-step state, independent retries, waiting, or compensation. Candidate use cases are a notification sequence with retry/backoff or a bounded enrichment sequence that must survive restarts after an Early Signal. They are not required for every discovered vacancy.

Workflows are not the default orchestration engine for discovery records. Simple queue-consumer operations remain ordinary Worker handlers to preserve the 3,000-step daily allowance and reduce complexity.

#### Optional Workers AI

Workers AI may enrich a small set of already persisted, deduplicated, deterministically eligible vacancies after heuristic scoring. Allowed tasks may include structured extraction or a secondary relevance explanation. It must never be required for collection, identity, deduplication, quota control, or basic alert delivery.

AI execution requires all of the following:

- an allowlisted Free-plan model;
- sufficient Budget Guard headroom;
- bounded input and output;
- schema validation of the response;
- stored model/version/prompt-version metadata;
- deterministic fallback when unavailable, throttled, or invalid.

## 5. Data lifecycle and state model

The conceptual durable records are:

- `discovery_round`: scheduled slot, status, portfolio revision, budget decision, counts, timings;
- `discovery_task`: round/query/adapter unit, idempotency key, attempt state, cost estimate;
- `observation`: persisted source evidence and normalized fields;
- `vacancy`: stable deduplicated domain identity;
- `vacancy_link`: evidence connecting observations to a vacancy;
- `decision`: versioned deterministic rules, Early Signal, eligibility outcome, reasons;
- `scoring`: heuristic score, feature evidence, rule version, and score outcome;
- `enrichment`: optional AI output with provenance and validation state;
- `notification_outbox`: channel payload reference, idempotency key, delivery state;
- `operational_event`: bounded structured diagnostics;
- `usage_ledger`: conservative quota usage and reservation by UTC day/service;
- `query_portfolio_revision`: immutable query configuration snapshot.

Detailed SQL schemas belong to the implementation plan, not this architecture specification.

### 5.1 Required state transitions

Each unit of work has explicit terminal outcomes such as `completed`, `skipped_budget`, `skipped_policy`, `permanent_failure`, or `exhausted_retries`. A round must finish with partial success when some adapters fail; it must not remain indefinitely “running.”

Retries use exponential backoff with jitter, a bounded attempt count, and a dead-letter or terminal-failure path. The original observation and failure classification remain auditable.

### 5.2 Retention

Retention must be explicit and storage-aware. High-volume operational events and obsolete observations are pruned or compacted after their configured diagnostic window, while stable vacancy identity, first-seen evidence, alert history, and aggregate metrics are retained longer. No retention job may erase records needed to explain a delivered alert.

## 6. Observability

Observability is part of the product, not a later dashboard. Every event must use bounded structured fields and correlation identifiers: `round_id`, `task_id`, `query_id`, `adapter_id`, and, where applicable, `vacancy_id` and `notification_id`.

Required signals:

- scheduled, started, completed, delayed, and skipped rounds;
- admitted/deferred tasks by query and adapter;
- adapter latency, yield, empty responses, throttling, schema changes, and failures;
- observations persisted, new vacancies, duplicates, and ambiguous matches;
- eligibility and Early Signal reason codes;
- queue retries, exhausted work, and backlog age;
- notification attempts and outcomes;
- usage versus internal budget for every metered service;
- AI invocation, model, neuron estimate/actual when available, validation, and fallback;
- retention and cleanup outcomes.

Logs must not contain secrets, authentication headers, or unnecessary personal data. High-cardinality or large source payloads must not be emitted to logs.

An operational health summary must be derivable without a frontend: latest successful round, last 24-hour coverage, current budget band, failing adapters, oldest queued work, and notification health.

## 7. Metrics

### 7.1 Product metrics

- New eligible vacancies discovered per day.
- Alerted vacancies per day and per query.
- Applications attributed to an alerted vacancy, when recorded by the external workflow.
- Funnel conversion by query: `jobs_found -> unique_jobs -> relevant_jobs -> alerts -> applications`.
- Time from trustworthy source publication to `first_seen_at`, reported only where publication time is reliable.
- Time from `first_seen_at` to alert delivery.
- Duplicate suppression rate.
- Query yield and eligible yield.
- Source contribution and source freshness confidence.
- Manual relevance precision from reviewed alert samples until an explicit feedback mechanism exists.
- Comparison against the Job Finder baseline for coverage, consistency, and discovery latency once equivalent observations exist.

### 7.2 Reliability metrics

- Scheduled rounds versus uniquely created rounds.
- Round completion and partial-success rates.
- Adapter success, throttling, schema-change, and retry-exhaustion rates.
- Queue redelivery and oldest-message age.
- Idempotency conflicts handled without duplicate side effects.
- Notification success and duplicate-notification rate.

### 7.3 Efficiency metrics

- Worker invocations and estimated CPU by completed round.
- Queue operations per persisted observation and per alert.
- D1 rows read/written per round and per new vacancy.
- Workflow steps per delivered alert.
- AI neurons per enriched and alerted vacancy.
- Percentage of each internal and platform budget consumed per UTC day.

Initial target values are hypotheses to be calibrated with real runs. The non-negotiable targets are zero paid usage, zero intentional duplicate alerts for the same idempotency key, and complete reason/provenance records for every alert.

## 8. Alternatives considered

### 8.1 One monolithic Cron Worker

**Advantages:** smallest initial surface and fewer services.

**Rejected as the target architecture because:** one invocation couples scheduling, remote latency, parsing, persistence, scoring, and notification. Partial failure is difficult to isolate, source work competes for subrequests, and retries can repeat successful side effects. A thin coordinator plus bounded queue tasks better matches the hourly cycle and failure model.

The first executable milestone may still prove only that Cron starts a round; it must not grow into the monolith.

### 8.2 Workflows for every vacancy

**Advantages:** durable steps and built-in retry semantics.

**Rejected for default processing because:** it spends scarce Free Tier steps on simple operations and introduces orchestration state where idempotent queue consumers are sufficient. Workflows remain selective.

### 8.3 External PostgreSQL or Supabase

**Advantages:** mature relational tooling and familiar operational model.

**Rejected because:** it violates the Cloudflare-only owned-runtime constraint and adds another availability, networking, credential, and cost boundary. D1 is sufficient for the MVP's relational and volume requirements.

### 8.4 KV as primary state

**Advantages:** simple globally distributed key access.

**Rejected because:** the core requires relational uniqueness, transactional state transitions, indexed operational queries, and auditable joins. D1 is a better source of truth. KV is explicitly outside the MVP.

### 8.5 Durable Objects for coordination

**Advantages:** strong per-object serialization and stateful coordination.

**Rejected because:** unique D1 constraints and idempotent state transitions can coordinate the expected MVP load without adding another state model. Reconsider only if measured concurrency produces unresolved contention.

### 8.6 R2 for raw captures

**Advantages:** inexpensive object storage and historical replay from full payloads.

**Rejected because:** full raw capture increases storage, privacy, retention, and source-policy obligations before the product needs it. The MVP persists minimum normalized evidence in D1.

### 8.7 Vectorize and embedding-based matching

**Advantages:** semantic retrieval and fuzzy cross-source similarity.

**Rejected because:** deterministic portfolio rules and fingerprints must be validated first. Vector infrastructure would add cost accounting and explainability complexity without proven need.

### 8.8 AI Gateway

**Advantages:** model analytics, caching, routing, and control.

**Rejected because:** the MVP uses at most one tightly bounded Workers AI path. Direct bindings plus Haadar's own usage ledger are sufficient until multi-model operations justify a gateway.

### 8.9 Frontend dashboard

**Advantages:** convenient exploration and operational visibility.

**Rejected because:** it does not improve the initial discovery hypothesis and would expand scope into authentication, authorization, UI maintenance, and additional requests. Logs, D1 metrics, alerts, and scoped operational tooling are sufficient.

## 9. Trade-offs accepted

- Cloudflare-only reduces vendor flexibility in exchange for a small, coherent operational surface.
- Free-only operation may skip low-priority searches during pressure instead of maximizing coverage.
- Persistence-first consumes writes but provides replayability, provenance, and defensible decisions.
- Deterministic matching is less semantically flexible than embeddings or LLM-first classification but is cheaper, testable, and explainable.
- Queue-based distribution introduces eventual completion and duplicate delivery but isolates failures and allows bounded retries.
- D1 centralizes relational truth but requires disciplined indexes, batched access, and retention to remain within row and storage quotas.
- No frontend makes analysis less convenient but keeps the MVP focused on discovery quality and reliability.
- The Cloudflare Prospector pattern is an architectural reference for distributed monitoring, persistence, and notifications; it is contextual evidence, not a Haadar dependency or a template to copy uncritically.

## 10. Security, privacy, and source policy

- Credentials are stored only as Cloudflare secrets and never persisted or logged.
- Administrative HTTP surfaces, if introduced, are deny-by-default and authenticated.
- Adapter allowlists define reachable hosts and redirect behavior.
- Remote responses have strict time, size, content-type, and parsing bounds.
- Source content is treated as untrusted data, including text later sent to AI.
- Stored content is minimized to what discovery, deduplication, explanation, and alerting require.
- Every adapter documents its access method, rate-limit behavior, and policy assumptions.
- Haadar does not bypass authentication, anti-bot controls, or explicit source restrictions.

## 11. Acceptance criteria

### 11.1 SPEC-001 acceptance

This specification is ready for implementation planning only when the user explicitly approves it and the following are true:

- Purpose, MVP boundary, and the meaning of Cloudflare-only/free-only are unambiguous.
- The hourly cadence and duplicate-schedule behavior are defined.
- Every included platform component has a specific responsibility.
- Every excluded platform component has a documented reason.
- Query Portfolio, adapters, persistence-first, deduplication, Early Signal, Budget Guard, observability, and optional AI have explicit boundaries.
- Failure, retry, idempotency, retention, and partial-success expectations are stated.
- Metrics can be derived without a frontend.
- Free Tier baselines are cited and marked for pre-deployment revalidation.
- No implementation code or implementation plan is included in this commit.

### 11.2 MVP architecture acceptance

The eventual MVP must demonstrate, through tests and controlled deployment evidence, that:

1. exactly one logical round exists for each admitted hourly slot despite duplicate invocation;
2. a round records its Query Portfolio revision and budget decision before distributing work;
3. at least one real adapter persists normalized evidence before classification;
4. queue redelivery and repeated adapter results do not create duplicate observations, vacancies, or alerts;
5. adapter failure produces a bounded retry or explicit terminal outcome without blocking the entire round;
6. an Early Signal can be emitted after the deterministic gate without waiting for the complete round, and final processing does not duplicate its alert;
7. Early Signal never presents an inferred publication time as a known fact;
8. heuristic scoring and Final Decision remain available when Workers AI is unavailable;
9. the Budget Guard suppresses optional work and then new work before configured ceilings;
10. every alert can be traced to source evidence, rule version, decision reasons, and delivery state;
11. current usage remains within revalidated Workers Free allowances during a representative observation period;
12. operational health can be determined without a frontend;
13. no excluded component is required for normal MVP operation.

## 12. Planned Git narrative

The repository history must reflect actual verified capability. The intended sequence is:

1. `docs: define Haadar purpose and free-first constraints`
2. `docs: add Haadar architecture specification`
3. implementation plan, only after SPEC-001 approval
4. `chore: bootstrap Cloudflare Workers project`
5. `feat: add scheduled discovery rounds`
6. `feat: persist discovery rounds in D1`
7. subsequent narrow commits for distribution, one adapter, persistence-first normalization, deduplication, deterministic decisions, Budget Guard, observability, notifications, selective Workflows, and optional AI

Later commit names are illustrative until the implementation plan is approved. Each behavior commit must include proportionate tests and must not claim production behavior that was not exercised.

## 13. Decision gate

No implementation plan, scaffold, dependency installation, Cloudflare resource creation, or application code may begin until the user reviews and explicitly approves SPEC-001. Requested revisions remain part of the architecture phase and will be committed as documentation changes.
