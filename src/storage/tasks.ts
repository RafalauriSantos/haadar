import type { DiscoveryTask } from "../domain/types";

export type TaskClaim =
  | { kind: "claimed"; task: DiscoveryTask; leaseToken: string }
  | { kind: "already_terminal"; status: "completed" | "terminal" }
  | { kind: "busy" };

export async function claimTaskForExecution(
  db: D1Database,
  task: DiscoveryTask,
  input: { now: string; leaseUntil: string; queueAttempts: number; leaseToken: string },
): Promise<TaskClaim> {
  const claimed = await db.prepare(
    `UPDATE discovery_tasks
     SET status = 'running', lease_token = ?, lease_expires_at = ?, queue_attempts = ?, updated_at = ?
     WHERE id = ? AND idempotency_key = ?
       AND (status IN ('pending', 'retryable') OR (status = 'running' AND lease_expires_at <= ?))
     RETURNING id`,
  ).bind(
    input.leaseToken,
    input.leaseUntil,
    input.queueAttempts,
    input.now,
    task.id,
    task.idempotencyKey,
    input.now,
  ).first<{ id: string }>();
  if (claimed) return { kind: "claimed", task, leaseToken: input.leaseToken };

  const existing = await db.prepare("SELECT status FROM discovery_tasks WHERE id = ? AND idempotency_key = ?")
    .bind(task.id, task.idempotencyKey).first<{ status: string }>();
  if (existing?.status === "completed" || existing?.status === "terminal") {
    return { kind: "already_terminal", status: existing.status };
  }
  return { kind: "busy" };
}

export async function finishTask(
  db: D1Database,
  input: {
    taskId: string;
    leaseToken: string;
    status: "completed" | "retryable" | "terminal";
    now: string;
    errorKind?: string;
    terminalReason?: string;
  },
): Promise<void> {
  const result = await db.prepare(
    `UPDATE discovery_tasks
     SET status = ?, last_error_kind = ?, terminal_reason = ?,
         completed_at = CASE WHEN ? IN ('completed', 'terminal') THEN ? ELSE NULL END,
         lease_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'running' AND lease_token = ?`,
  ).bind(
    input.status,
    input.errorKind ?? null,
    input.terminalReason ?? null,
    input.status,
    input.now,
    input.now,
    input.taskId,
    input.leaseToken,
  ).run();
  if (result.meta.changes !== 1) throw new Error(`task lease lost for ${input.taskId}`);
  await reconcileRoundForTask(db, input.taskId, input.now);
}

export async function reconcileExpiredTaskLeases(db: D1Database, now: string): Promise<number> {
  const result = await db.prepare(
    `UPDATE discovery_tasks
     SET status = 'retryable', lease_token = NULL, lease_expires_at = NULL,
         last_error_kind = 'lease_expired', updated_at = ?
     WHERE status = 'running' AND lease_expires_at <= ?`,
  ).bind(now, now).run();
  return result.meta.changes;
}

export async function recoverExpiredTaskPublications(
  db: D1Database,
  input: { now: Date; leaseMs: number; limit?: number },
): Promise<DiscoveryTask[]> {
  const now = input.now.toISOString();
  const expired = await db.prepare(
    `UPDATE discovery_tasks
     SET status = 'retryable', lease_token = NULL, lease_expires_at = NULL,
         last_error_kind = 'lease_expired', updated_at = ?
     WHERE id IN (
       SELECT id FROM discovery_tasks
       WHERE status = 'running' AND lease_expires_at <= ?
       ORDER BY lease_expires_at LIMIT ?
     )
     RETURNING id`,
  ).bind(now, now, input.limit ?? 20).all<{ id: string }>();
  if (expired.results.length === 0) return [];

  const ids = expired.results.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  await db.prepare(
    `UPDATE task_publications
     SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE task_id IN (${placeholders})`,
  ).bind(now, ...ids).run();

  const leaseToken = crypto.randomUUID();
  const leased = await db.prepare(
    `UPDATE task_publications
     SET status = 'leased', lease_token = ?, lease_expires_at = ?,
         publish_attempts = publish_attempts + 1, updated_at = ?
     WHERE task_id IN (${placeholders}) AND status = 'pending'
     RETURNING task_id`,
  ).bind(leaseToken, new Date(input.now.getTime() + input.leaseMs).toISOString(), now, ...ids)
    .all<{ task_id: string }>();
  if (leased.results.length === 0) return [];

  const leasedIds = leased.results.map((row) => row.task_id);
  const leasedPlaceholders = leasedIds.map(() => "?").join(",");
  const tasks = await db.prepare(
    `SELECT id, round_id, query_id, adapter_id, idempotency_key, attempt, delivery_mode
     FROM discovery_tasks WHERE id IN (${leasedPlaceholders}) ORDER BY id`,
  ).bind(...leasedIds).all<{
    id: string; round_id: string; query_id: string; adapter_id: string;
    idempotency_key: string; attempt: number; delivery_mode: "live" | "silent";
  }>();
  return tasks.results.map((task) => ({
    id: task.id,
    roundId: task.round_id,
    queryId: task.query_id,
    adapterId: task.adapter_id,
    idempotencyKey: task.idempotency_key,
    attempt: task.attempt,
    deliveryMode: task.delivery_mode,
    publicationLeaseToken: leaseToken,
  }));
}

async function reconcileRoundForTask(db: D1Database, taskId: string, now: string): Promise<void> {
  await db.prepare(
    `UPDATE discovery_rounds
     SET status = CASE
       WHEN EXISTS (SELECT 1 FROM discovery_tasks WHERE round_id = discovery_rounds.id AND status IN ('pending', 'running', 'retryable'))
         THEN 'running'
       WHEN EXISTS (SELECT 1 FROM discovery_tasks WHERE round_id = discovery_rounds.id AND status = 'terminal')
         THEN 'partial'
       ELSE 'completed'
     END,
     updated_at = ?
     WHERE id = (SELECT round_id FROM discovery_tasks WHERE id = ?)`,
  ).bind(now, taskId).run();
  const reservation = await db.prepare(
    `SELECT br.* FROM budget_reservations br
     WHERE br.round_id = (SELECT round_id FROM discovery_tasks WHERE id = ?)
       AND br.status = 'reserved'
       AND NOT EXISTS (
         SELECT 1 FROM discovery_tasks
         WHERE round_id = br.round_id AND status IN ('pending', 'running', 'retryable')
       )`,
  ).bind(taskId).first<{
    round_id: string;
    usage_day: string;
    workers_requests: number;
    queue_operations: number;
    d1_rows_read: number;
    d1_rows_written: number;
    workflow_steps: number;
    ai_neurons: number;
  }>();
  if (!reservation) return;
  const estimates = [
    ["workers_requests", reservation.workers_requests],
    ["queue_operations", reservation.queue_operations],
    ["d1_rows_read", reservation.d1_rows_read],
    ["d1_rows_written", reservation.d1_rows_written],
    ["workflow_steps", reservation.workflow_steps],
    ["ai_neurons", reservation.ai_neurons],
  ] as const;
  await db.batch([
    ...estimates.map(([service, amount]) => db.prepare(
      `INSERT INTO usage_ledger
        (event_key, usage_day, service, amount, created_at, measurement_kind)
       VALUES (?, ?, ?, ?, ?, 'estimated')
       ON CONFLICT(event_key) DO NOTHING`,
    ).bind(`reservation:${reservation.round_id}:${service}`, reservation.usage_day, service, amount, now)),
    db.prepare(
      "UPDATE budget_reservations SET status = 'consumed', updated_at = ? WHERE round_id = ? AND status = 'reserved'",
    ).bind(now, reservation.round_id),
  ]);
}
