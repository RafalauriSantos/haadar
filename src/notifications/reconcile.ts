/**
 * Aligns the durable alert intent with a delivery that the provider already
 * confirmed. It never selects pending work and therefore cannot trigger a send.
 */
export async function reconcileConfirmedDeliveries(db: D1Database, now = new Date()): Promise<number> {
  const result = await db.prepare(
    `UPDATE alert_intents
     SET status = 'sent',
         delivered_at = COALESCE(delivered_at, (
           SELECT sent_at FROM notification_deliveries
           WHERE notification_deliveries.intent_key = alert_intents.idempotency_key
         )),
         updated_at = ?
     WHERE status = 'pending'
       AND EXISTS (
         SELECT 1 FROM notification_deliveries
         WHERE notification_deliveries.intent_key = alert_intents.idempotency_key
           AND notification_deliveries.state = 'sent'
       )`,
  ).bind(now.toISOString()).run();
  return result.meta.changes;
}
