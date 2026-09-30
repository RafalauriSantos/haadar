# Haadar Free-Tier Operations

## Before a deployment

1. Revalidate current Workers, Queues, D1, Workflows, and Workers AI free allowances against the official Cloudflare documentation.
2. Run `npm run check`; this command type-checks and tests, but never deploys.
3. Apply migrations to the intended environment only after naming that environment explicitly.
4. Confirm the Budget Guard ceilings reserve capacity for retries and control-plane work.

## Environment boundaries

| Intent | Command | D1 target | Cloudflare credentials |
| --- | --- | --- | --- |
| Unit and integration verification | `npm run check` | Disposable local D1 provided by Miniflare | Not required |
| Focused database integration | `npm run test:integration` | Disposable local D1; migrations applied per test suite | Not required |
| Local development | `npm run dev` | Local Wrangler emulation | Not required |
| Staging preview | `npm run dev:remote` | No binding until staging resources are intentionally provisioned | Required |
| Production migration | `npx wrangler d1 migrations apply haadar --remote --env production` | Production D1 | Required |
| Production deploy | `npm run deploy:production` | Production bindings declared under `env.production` | Required |

The top-level bindings are local defaults. Only `env.production` contains the
existing production resource identifiers and sets `remote = true`. Staging is a
separate named environment deliberately blocked from data access until dedicated
resources are created; do not point it at production as a shortcut.

## Toolchain security

Tool versions are exact in `package.json` and the lockfile. On 30/09/2026 the
project migrated from the deprecated Workers Vitest pool to the supported
Cloudflare Vitest plugin. `npm audit` then reported zero known vulnerabilities.
Any future nonzero audit result is a deployment blocker until its reachable
impact and resolution are recorded here.

## Health check

The operational summary must answer: latest successful round, last 24-hour coverage, current Budget Guard state, failing adapters, oldest queued work, and notification health. No dashboard is required.

## Budget response

- `NORMAL`: admit normal bounded work.
- `CONSERVATIVE`: reduce experimental queries and optional enrichment.
- `ESSENTIAL`: stop AI and optional Workflows; keep only essential discovery and retries.
- `EMERGENCY`: defer nonessential work and wait for the provider reset boundary.

Reservations are conservative estimates and are recorded as `estimated` when a
round terminates; provider-derived counters, when available, are recorded as
`measured`. The ledger only sees Haadar activity. Other projects sharing the
same Cloudflare account remain outside its direct view, so the configured
reserve and the pre-deploy account check are mandatory operating margin.

## Optional Workflow and AI

Revalidated on 30/09/2026: the [Cloudflare Workflows pricing reference](https://developers.cloudflare.com/workflows/reference/pricing/)
lists a Free allowance of 3,000 workflow steps per day. Haadar reserves only
2,400 daily workflow steps, leaving room for control-plane work and retries.
The enrichment workflow retains successful instances for one day and errored
instances for two days, below the documented free default retention boundary.

Workers AI is intentionally disabled in this pilot: no model is allowlisted and
no AI binding is configured. A model can be enabled only after its Free
eligibility is rechecked in current official documentation and the Budget Guard
has capacity. A failed, unavailable, throttled, timed-out, or malformed AI
response always records a fallback and never blocks the deterministic decision
or Early Signal path.

## Incident rules

- Never enable paid billing to bypass a quota incident without a new architecture decision.
- Never retry a blocked or policy-prohibited source indefinitely.
- Preserve the evidence and reason code for every alert.
- Inspect the usage ledger before changing concurrency or query volume.
