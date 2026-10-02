export interface OperationalHealthSummary {
  asOf: string;
  latestTerminalRound: { id: string; status: "completed" | "partial" | "deferred"; finishedAt: string } | null;
  roundsLast24Hours: { expected: number; observed: number; terminal: number; missing: number };
  budgetState: string | null;
  failingAdapters: number;
  anomalousSources: number;
  oldestQueuedWork: string | null;
  expiredLeases: number;
  pausedSources: number;
  deliveryBacklog: number;
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
  const [observed, terminal, latestBudget, failingAdapters, anomalousSources, oldestQueued, expiredLeases, pausedSources, pendingAlerts, failedAlerts, sentAlerts, deliveryBacklog] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM discovery_rounds WHERE scheduled_at >= ?").bind(windowStart).first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM discovery_rounds WHERE scheduled_at >= ? AND status IN ('completed', 'partial', 'deferred')").bind(windowStart).first<CountRow>(),
    db.prepare("SELECT budget_state FROM discovery_rounds ORDER BY scheduled_at DESC LIMIT 1").first<{ budget_state: string }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT adapter_id) AS count FROM operational_events
       WHERE created_at >= ? AND event_type IN ('adapter_diagnostic', 'task_retryable_failure', 'task_terminal')`,
    ).bind(windowStart).first<CountRow>(),
    db.prepare(
      `SELECT COUNT(DISTINCT json_extract(payload_json, '$.sourceKey')) AS count FROM operational_events
       WHERE created_at >= ? AND event_type = 'source_canary'
         AND json_extract(payload_json, '$.state') = 'anomalous'`,
    ).bind(windowStart).first<CountRow>(),
    db.prepare(
      `SELECT MIN(created_at) AS created_at FROM discovery_tasks
       WHERE status IN ('pending', 'running', 'retryable')`,
    ).first<{ created_at: string | null }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM discovery_tasks
       WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?`,
    ).bind(asOf).first<CountRow>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM source_health WHERE paused_until IS NOT NULL AND paused_until > ?",
    ).bind(asOf).first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE status = 'pending'").first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE status = 'failed'").first<CountRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE status = 'sent'").first<CountRow>(),
    db.prepare(
      "SELECT COUNT(*) AS count FROM notification_deliveries WHERE state IN ('pending', 'retryable', 'unknown')",
    ).first<CountRow>(),
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
    anomalousSources: anomalousSources?.count ?? 0,
    oldestQueuedWork: oldestQueued?.created_at ?? null,
    expiredLeases: expiredLeases?.count ?? 0,
    pausedSources: pausedSources?.count ?? 0,
    deliveryBacklog: deliveryBacklog?.count ?? 0,
    notificationHealth: failed > 0 || (deliveryBacklog?.count ?? 0) > 0 ? "degraded" : pending > 0 ? "pending" : sent > 0 ? "healthy" : "unknown",
  };
}
