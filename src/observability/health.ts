export interface OperationalHealthSummary {
  asOf: string;
  latestTerminalRound: { id: string; status: "completed" | "partial" | "deferred"; finishedAt: string } | null;
  roundsLast24Hours: { expected: number; observed: number; terminal: number; missing: number };
  budgetState: string | null;
  failingAdapters: number;
  oldestQueuedWork: string | null;
  notificationHealth: "unknown" | "pending" | "healthy" | "degraded";
}

type CountRow = { count: number };

export async function getOperationalHealth(db: D1Database, now = new Date()): Promise<OperationalHealthSummary> {
  const asOf = now.toISOString();
  const windowStart = new Date(now.getTime() - 86_400_000).toISOString();
  const latest = await db.prepare(
    `SELECT id, status, updated_at FROM discovery_rounds
     WHERE status IN ('completed', 'partial', 'deferred')
     ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ id: string; status: "completed" | "partial" | "deferred"; updated_at: string }>();
  const [observed, terminal, latestBudget, failingAdapters, oldestQueued, pendingAlerts, failedAlerts, sentAlerts] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM discovery_rounds WHERE scheduled_at >= ?").bind(windowStart).first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM discovery_rounds WHERE scheduled_at >= ? AND status IN ('completed', 'partial', 'deferred')").bind(windowStart).first<CountRow>(),
    db.prepare("SELECT budget_state FROM discovery_rounds ORDER BY scheduled_at DESC LIMIT 1").first<{ budget_state: string }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT adapter_id) AS count FROM operational_events
       WHERE created_at >= ? AND event_type IN ('adapter_diagnostic', 'task_retryable_failure', 'task_terminal')`,
    ).bind(windowStart).first<CountRow>(),
    db.prepare(
      `SELECT MIN(created_at) AS created_at FROM discovery_tasks
       WHERE status IN ('pending', 'running', 'retryable')`,
    ).first<{ created_at: string | null }>(),
    db.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE status = 'pending'").first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE status = 'failed'").first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE status = 'sent'").first<CountRow>(),
  ]);
  const expected = 24;
  const pending = pendingAlerts?.count ?? 0;
  const failed = failedAlerts?.count ?? 0;
  const sent = sentAlerts?.count ?? 0;
  return {
    asOf,
    latestTerminalRound: latest ? { id: latest.id, status: latest.status, finishedAt: latest.updated_at } : null,
    roundsLast24Hours: { expected, observed: observed?.count ?? 0, terminal: terminal?.count ?? 0, missing: Math.max(0, expected - (observed?.count ?? 0)) },
    budgetState: latestBudget?.budget_state ?? null,
    failingAdapters: failingAdapters?.count ?? 0,
    oldestQueuedWork: oldestQueued?.created_at ?? null,
    notificationHealth: failed > 0 ? "degraded" : pending > 0 ? "pending" : sent > 0 ? "healthy" : "unknown",
  };
}
