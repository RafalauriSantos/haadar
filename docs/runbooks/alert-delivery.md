# Alert delivery pilot

The first delivery adapter is Telegram. Configure these only as Cloudflare
secrets in the target environment, never in `wrangler.toml`, source code or
Git history:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_DESTINATION`

An intent is sent only when both values exist. Telegram responses classified as
success persist the provider message ID. A 429 or 5xx becomes retryable with a
bounded next attempt. A rejected destination becomes failed. A transport
timeout becomes `unknown`: Telegram may have accepted it, so Haadar does not
blindly retry.

## Prevention and recovery

The persisted vacancy payload uses `canonicalUrl`; the delivery formatter maps
that field to the Telegram card URL. Keep this mapping covered by an
integration test so a payload-contract change cannot leave a delivery in
`sending` before the provider call.

Outbound Telegram calls have a 10-second deadline. If a Worker is interrupted
before confirmation, its delivery lease becomes `unknown` rather than being
automatically resent. This is intentional: Telegram has no idempotency key for
this request, so an automatic retry could duplicate a message.

An operator may release an `unknown` delivery only after confirming that it
was not received and that its `provider_message_id` is empty. Record the
reason for the release, dispatch it through the current Worker version, then
verify both a persisted provider message ID and `alert_intents.status = sent`.

Before the controlled pilot, the user must identify the approved personal
destination. After deployment, send one real alert, verify receipt, and query
the matching `alert_intents` and `notification_deliveries` rows by the recorded
idempotency key. Do not use a third-party or inherited chat ID.
