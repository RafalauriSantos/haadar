import { formatTelegramAlert, type TelegramAlertCard, type TelegramClient } from "./telegram";

interface DeliveryRow {
  intent_key: string;
  payload_json: string;
  stage: "provisional" | "final";
}

export async function dispatchOne(
  db: D1Database,
  client: TelegramClient,
  now = new Date(),
): Promise<"none" | "sent" | "retryable" | "failed" | "unknown"> {
  const nowIso = now.toISOString();
  const lease = crypto.randomUUID();
  await db.prepare(
    `UPDATE notification_deliveries
     SET state = 'unknown', last_error_kind = 'delivery_lease_expired',
         lease_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE state = 'sending' AND lease_expires_at <= ?`,
  ).bind(nowIso, nowIso).run();
  await db.prepare(
    `INSERT INTO notification_deliveries (intent_key, state, created_at, updated_at)
     SELECT idempotency_key, 'pending', ?, ? FROM alert_intents
     WHERE channel = 'telegram' AND status = 'pending'
     ON CONFLICT(intent_key) DO NOTHING`,
  ).bind(nowIso, nowIso).run();
  const claimed = await db.prepare(
    `UPDATE notification_deliveries SET state = 'sending', lease_token = ?,
       lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
     WHERE intent_key = (
       SELECT nd.intent_key FROM notification_deliveries nd
       JOIN alert_intents ai ON ai.idempotency_key = nd.intent_key
       WHERE nd.state IN ('pending', 'retryable')
         AND (nd.next_attempt_at IS NULL OR nd.next_attempt_at <= ?)
         AND ai.status = 'pending'
       ORDER BY ai.created_at LIMIT 1
     ) AND state IN ('pending', 'retryable')
     RETURNING intent_key`,
  ).bind(lease, new Date(now.getTime() + 120_000).toISOString(), nowIso, nowIso).first<{ intent_key: string }>();
  if (!claimed) return "none";
  const row = await db.prepare(
    `SELECT ai.idempotency_key AS intent_key, ai.payload_json, ai.stage
     FROM alert_intents ai WHERE ai.idempotency_key = ?`,
  ).bind(claimed.intent_key).first<DeliveryRow>();
  if (!row) return "unknown";
  const payload = parseTelegramAlertCard(row.payload_json);
  if (!payload) return mark(db, row.intent_key, lease, "failed", now, "invalid_payload");
  const response = await client.send(formatTelegramAlert({ ...payload, stage: row.stage }));
  if (response.kind === "sent") {
    await db.batch([
      db.prepare(`UPDATE notification_deliveries SET state = 'sent', provider_message_id = ?, sent_at = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE intent_key = ? AND lease_token = ?`)
        .bind(response.messageId, nowIso, nowIso, row.intent_key, lease),
      db.prepare("UPDATE alert_intents SET status = 'sent', delivered_at = ?, updated_at = ? WHERE idempotency_key = ?")
        .bind(nowIso, nowIso, row.intent_key),
    ]);
    return "sent";
  }
  if (response.kind === "retryable") {
    const retryAt = new Date(now.getTime() + Math.max(30, response.retryAfterSeconds ?? 60) * 1_000).toISOString();
    await db.prepare(`UPDATE notification_deliveries SET state = 'retryable', next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL, last_error_kind = 'provider_retryable', updated_at = ? WHERE intent_key = ? AND lease_token = ?`)
      .bind(retryAt, nowIso, row.intent_key, lease).run();
    return "retryable";
  }
  if (response.kind === "unknown") {
    await db.prepare(`UPDATE notification_deliveries SET state = 'unknown', last_error_kind = 'ambiguous_transport', lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE intent_key = ? AND lease_token = ?`)
      .bind(nowIso, row.intent_key, lease).run();
    return "unknown";
  }
  return mark(db, row.intent_key, lease, "failed", now, "provider_rejected");
}

async function mark(db: D1Database, intentKey: string, lease: string, state: "failed", now: Date, error: string): Promise<"failed"> {
  const nowIso = now.toISOString();
  await db.batch([
    db.prepare(`UPDATE notification_deliveries SET state = ?, last_error_kind = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE intent_key = ? AND lease_token = ?`)
      .bind(state, error, nowIso, intentKey, lease),
    db.prepare("UPDATE alert_intents SET status = 'failed', updated_at = ? WHERE idempotency_key = ?").bind(nowIso, intentKey),
  ]);
  return state;
}

function parseTelegramAlertCard(payloadJson: string): TelegramAlertCard | null {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const url = typeof payload.url === "string" ? payload.url : payload.canonicalUrl;
    if (typeof payload.title !== "string" || typeof url !== "string") return null;
    return {
      title: payload.title,
      organization: typeof payload.organization === "string" ? payload.organization : null,
      location: typeof payload.location === "string" ? payload.location : null,
      source: typeof payload.source === "string" ? payload.source : null,
      url,
      stage: "final",
    };
  } catch {
    return null;
  }
}
