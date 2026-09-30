# Phase 2 — Production validation record

**Status:** preparation in progress. The production trial has not happened.

## Preconditions

1. Confirm Cloudflare account quotas and shared consumption on the same day.
2. Configure `OPERATIONS_TOKEN`, `ADMIN_TRIGGER_TOKEN`, `TELEGRAM_BOT_TOKEN`
   and `TELEGRAM_DESTINATION` as production secrets; record secret *names only*.
3. Run `npm run check` and `npx wrangler deploy --dry-run --env production`.
4. Apply migrations incrementally with `npx wrangler d1 migrations apply haadar --remote --env production`.
5. Deploy the verified SHA only after the migration result is recorded.

## Controlled run

`POST /admin/discovery` requires `Authorization: Bearer <ADMIN_TRIGGER_TOKEN>`.
It has no public route and uses the normal idempotent round slot and Budget
Guard; repeating a request for the same slot must not create a new logical
round. Record the resulting round ID, Queue task state, real vacancy, decision,
delivery intent and Telegram provider message ID.

## Observation window

Observe two consecutive scheduled rounds and a full 24-hour window before
closing this phase. The expected cadence is sixteen 90-minute slots. Missing
slots require an explicit documented reason; local Queue evidence does not
replace remote Queue evidence.

## Evidence fields to fill after execution

| Field | Value |
| --- | --- |
| Deployment SHA | pending |
| Migration result | 30/09/2026: migrations 0002 through 0007 applied remotely; a follow-up list returned no pending migrations |
| Controlled round ID | pending |
| Queue task terminal state | pending |
| Alert intent / provider message ID | pending |
| Two scheduled rounds | pending |
| 24-hour quota review | pending |
