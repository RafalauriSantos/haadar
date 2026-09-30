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

Before the controlled pilot, the user must identify the approved personal
destination. After deployment, send one real alert, verify receipt, and query
the matching `alert_intents` and `notification_deliveries` rows by the recorded
idempotency key. Do not use a third-party or inherited chat ID.
