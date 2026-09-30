# Haadar

Haadar is a backend-only job discovery system designed to find relevant opportunities earlier, with predictable operation and no mandatory infrastructure cost.

The project will be built incrementally on Cloudflare, beginning with architecture and engineering constraints before any implementation. Its first release targets the Workers Free plan and must remain within free-tier quotas by design, not by accident.

## Product intent

Haadar periodically explores a controlled portfolio of job-search queries, collects results through source-specific adapters, persists evidence before downstream processing, removes duplicates, detects early signals, and emits actionable alerts.

It is not a dashboard, crawler-at-any-cost, or general-purpose recruitment platform. The MVP is an observable serverless backend whose outputs are delivered through notification channels.

## Non-negotiable constraints

- Cloudflare-native runtime and managed services only.
- Zero mandatory infrastructure spend on the MVP.
- A discovery round starts every 90 minutes.
- Backend-only: no frontend is required for the MVP.
- Deterministic filtering and persistence come before optional AI enrichment.
- Every external source is isolated behind an adapter.
- Quotas are treated as hard operating limits.

## Project history

The repository intentionally evolves in small, reviewable steps:

1. Define the purpose and free-first constraints.
2. Approve the architecture specification.
3. Plan implementation only after the specification is accepted.
4. Bootstrap the smallest technical foundation.
5. Add one provable behavior at a time, with tests and observability.

## Current status

Architecture definition. [`SPEC-001 — Haadar Architecture & Engineering Constraints`](docs/specs/SPEC-001-haadar-architecture-and-engineering-constraints.md) is proposed for review. Implementation planning remains blocked until it is approved.

