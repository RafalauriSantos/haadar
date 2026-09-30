import type { D1DatabaseLike, OperationalEvent } from "../storage/d1";

export async function recordEvent(db: D1DatabaseLike, event: OperationalEvent): Promise<void> {
  await db.prepare(
    `INSERT INTO operational_events
      (event_key, event_type, round_id, task_id, query_id, adapter_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_key) DO NOTHING`
  ).bind(
    event.eventKey,
    event.eventType,
    event.roundId ?? null,
    event.taskId ?? null,
    event.queryId ?? null,
    event.adapterId ?? null,
    JSON.stringify(event.payload),
    new Date().toISOString()
  ).run();
}
