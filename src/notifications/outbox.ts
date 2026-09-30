import type { D1DatabaseLike } from "../storage/d1";

export interface NotificationInput {
  idempotencyKey: string;
  channel: string;
  payload: Record<string, unknown>;
}

export async function enqueueNotification(db: D1DatabaseLike, input: NotificationInput): Promise<void> {
  await db.prepare(
    `INSERT INTO notification_outbox (idempotency_key, channel, payload_json, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)
     ON CONFLICT(idempotency_key) DO NOTHING`
  ).bind(input.idempotencyKey, input.channel, JSON.stringify(input.payload), new Date().toISOString()).run();
}
