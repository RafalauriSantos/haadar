import { decideBudget, type UsageSnapshot } from "./budget-guard";
import { freeFirstConfig, type DailyCeilings, type FreeFirstConfig } from "../config";

export interface BudgetCost extends UsageSnapshot {}

export function utcDay(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new RangeError("budget timestamp must be valid");
  return at.toISOString().slice(0, 10);
}

export async function readUsageSnapshot(db: D1Database, day: string): Promise<UsageSnapshot> {
  const rows = await db.prepare(
    `SELECT service, SUM(amount) AS amount FROM usage_ledger WHERE usage_day = ? GROUP BY service`,
  ).bind(day).all<{ service: string; amount: number }>();
  const reserved = await db.prepare(
    `SELECT
       coalesce(SUM(workers_requests), 0) workers_requests,
       coalesce(SUM(queue_operations), 0) queue_operations,
       coalesce(SUM(d1_rows_read), 0) d1_rows_read,
       coalesce(SUM(d1_rows_written), 0) d1_rows_written,
       coalesce(SUM(workflow_steps), 0) workflow_steps,
       coalesce(SUM(ai_neurons), 0) ai_neurons
     FROM budget_reservations WHERE usage_day = ? AND status = 'reserved'`,
  ).bind(day).first<{
    workers_requests: number;
    queue_operations: number;
    d1_rows_read: number;
    d1_rows_written: number;
    workflow_steps: number;
    ai_neurons: number;
  }>();
  const snapshot = emptyUsage();
  const serviceMap: Record<string, keyof UsageSnapshot> = {
    workers_requests: "workersRequests",
    queue_operations: "queueOperations",
    d1_rows_read: "d1RowsRead",
    d1_rows_written: "d1RowsWritten",
    workflow_steps: "workflowSteps",
    ai_neurons: "aiNeurons",
  };
  for (const row of rows.results) {
    const key = serviceMap[row.service];
    if (key) snapshot[key] += Number(row.amount);
  }
  if (reserved) {
    snapshot.workersRequests += Number(reserved.workers_requests);
    snapshot.queueOperations += Number(reserved.queue_operations);
    snapshot.d1RowsRead += Number(reserved.d1_rows_read);
    snapshot.d1RowsWritten += Number(reserved.d1_rows_written);
    snapshot.workflowSteps += Number(reserved.workflow_steps);
    snapshot.aiNeurons += Number(reserved.ai_neurons);
  }
  return snapshot;
}

export async function reserveRoundBudget(
  db: D1Database,
  input: { roundId: string; day: string; cost: BudgetCost; now: string; reason: string },
  config: FreeFirstConfig = freeFirstConfig,
): Promise<{ admitted: boolean; usage: UsageSnapshot }> {
  validateCost(input.cost);
  const usage = await readUsageSnapshot(db, input.day);
  const decision = decideBudget(usage, config);
  if (!decision.admitEssential) return { admitted: false, usage };
  const limits = admissionLimits(config.ceilings, Math.min(config.emergencyRatio, 1 - config.reserveRatio));
  const result = await db.prepare(
    `INSERT INTO budget_reservations
      (round_id, usage_day, workers_requests, queue_operations, d1_rows_read, d1_rows_written,
       workflow_steps, ai_neurons, status, reason, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?
     WHERE
       (SELECT coalesce(SUM(amount), 0) FROM usage_ledger WHERE usage_day = ? AND service = 'workers_requests')
       + (SELECT coalesce(SUM(workers_requests), 0) FROM budget_reservations WHERE usage_day = ? AND status IN ('reserved', 'consumed')) + ? <= ?
       AND (SELECT coalesce(SUM(amount), 0) FROM usage_ledger WHERE usage_day = ? AND service = 'queue_operations')
       + (SELECT coalesce(SUM(queue_operations), 0) FROM budget_reservations WHERE usage_day = ? AND status IN ('reserved', 'consumed')) + ? <= ?
       AND (SELECT coalesce(SUM(amount), 0) FROM usage_ledger WHERE usage_day = ? AND service = 'd1_rows_read')
       + (SELECT coalesce(SUM(d1_rows_read), 0) FROM budget_reservations WHERE usage_day = ? AND status IN ('reserved', 'consumed')) + ? <= ?
       AND (SELECT coalesce(SUM(amount), 0) FROM usage_ledger WHERE usage_day = ? AND service = 'd1_rows_written')
       + (SELECT coalesce(SUM(d1_rows_written), 0) FROM budget_reservations WHERE usage_day = ? AND status IN ('reserved', 'consumed')) + ? <= ?
       AND (SELECT coalesce(SUM(amount), 0) FROM usage_ledger WHERE usage_day = ? AND service = 'workflow_steps')
       + (SELECT coalesce(SUM(workflow_steps), 0) FROM budget_reservations WHERE usage_day = ? AND status IN ('reserved', 'consumed')) + ? <= ?
     ON CONFLICT(round_id) DO NOTHING`,
  ).bind(
    input.roundId,
    input.day,
    input.cost.workersRequests,
    input.cost.queueOperations,
    input.cost.d1RowsRead,
    input.cost.d1RowsWritten,
    input.cost.workflowSteps,
    input.cost.aiNeurons,
    input.reason,
    input.now,
    input.now,
    input.day,
    input.day,
    input.cost.workersRequests,
    limits.workersRequests,
    input.day,
    input.day,
    input.cost.queueOperations,
    limits.queueOperations,
    input.day,
    input.day,
    input.cost.d1RowsRead,
    limits.d1RowsRead,
    input.day,
    input.day,
    input.cost.d1RowsWritten,
    limits.d1RowsWritten,
    input.day,
    input.day,
    input.cost.workflowSteps,
    limits.workflowSteps,
  ).run();
  if (result.meta.changes === 1) return { admitted: true, usage };
  const existing = await db.prepare(
    "SELECT status FROM budget_reservations WHERE round_id = ?",
  ).bind(input.roundId).first<{ status: string }>();
  return { admitted: existing?.status === "reserved" || existing?.status === "consumed", usage };
}

export async function consumeReservation(db: D1Database, roundId: string, now: string): Promise<void> {
  await db.prepare(
    "UPDATE budget_reservations SET status = 'consumed', updated_at = ? WHERE round_id = ? AND status = 'reserved'",
  ).bind(now, roundId).run();
}

export function estimateRoundCost(tasks: number, includeEnrichment = false): BudgetCost {
  if (!Number.isInteger(tasks) || tasks < 0) throw new RangeError("task count must be a non-negative integer");
  return {
    workersRequests: 1 + tasks,
    queueOperations: tasks * 3,
    d1RowsRead: 8 + tasks * 6,
    d1RowsWritten: 6 + tasks * 10,
    workflowSteps: includeEnrichment ? tasks * 3 : 0,
    aiNeurons: 0,
  };
}

function emptyUsage(): UsageSnapshot {
  return { workersRequests: 0, queueOperations: 0, d1RowsRead: 0, d1RowsWritten: 0, workflowSteps: 0, aiNeurons: 0 };
}

function admissionLimits(ceilings: DailyCeilings, ratio: number): DailyCeilings {
  return Object.fromEntries(Object.entries(ceilings).map(([key, value]) => [key, Math.floor(value * ratio)])) as unknown as DailyCeilings;
}

function validateCost(cost: BudgetCost): void {
  if (Object.values(cost).some((value) => !Number.isFinite(value) || value < 0 || !Number.isInteger(value))) {
    throw new RangeError("budget cost must contain non-negative finite integers");
  }
}
