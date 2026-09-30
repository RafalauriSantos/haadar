# Haadar Free-Tier Operations

## Before a deployment

1. Revalidate current Workers, Queues, D1, Workflows, and Workers AI free allowances against the official Cloudflare documentation.
2. Replace the local D1 placeholder with a real database ID only after the resource is intentionally created.
3. Apply migrations and run the complete test suite.
4. Confirm the Budget Guard ceilings reserve capacity for retries and control-plane work.

## Health check

The operational summary must answer: latest successful round, last 24-hour coverage, current Budget Guard state, failing adapters, oldest queued work, and notification health. No dashboard is required.

## Budget response

- `NORMAL`: admit normal bounded work.
- `CONSERVATIVE`: reduce experimental queries and optional enrichment.
- `ESSENTIAL`: stop AI and optional Workflows; keep only essential discovery and retries.
- `EMERGENCY`: defer nonessential work and wait for the provider reset boundary.

## Incident rules

- Never enable paid billing to bypass a quota incident without a new architecture decision.
- Never retry a blocked or policy-prohibited source indefinitely.
- Preserve the evidence and reason code for every alert.
- Inspect the usage ledger before changing concurrency or query volume.
