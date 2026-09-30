import type { D1DatabaseLike } from "../storage/d1";

export type UsageService = "workers_requests" | "queue_operations" | "d1_rows_read" | "d1_rows_written" | "workflow_steps" | "ai_neurons";

export async function recordUsage(db: D1DatabaseLike, eventKey: string, day: string, service: UsageService, delta: number): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError("usage day must be UTC YYYY-MM-DD");
  if (!Number.isFinite(delta) || delta < 0) throw new RangeError("usage delta must be finite and non-negative");
  await db.prepare(
    `INSERT INTO usage_ledger (event_key, usage_day, service, amount, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_key) DO NOTHING`
  ).bind(eventKey, day, service, delta, new Date().toISOString()).run();
}

export interface HealthSummary {
  latestRound: string | null;
  budgetState: string | null;
  failingAdapters: number;
  oldestQueuedWork: string | null;
  notificationHealth: "unknown";
}

export function emptyHealthSummary(): HealthSummary {
  return { latestRound: null, budgetState: null, failingAdapters: 0, oldestQueuedWork: null, notificationHealth: "unknown" };
}
