export interface SourceHealth {
  sourceId: string;
  consecutiveFailures: number;
  pausedUntil: string | null;
  lastFailureKind: string | null;
}

const FAILURE_THRESHOLD = 3;
const PAUSE_MS = 6 * 60 * 60_000;

export async function getSourceHealth(db: D1Database, sourceId: string): Promise<SourceHealth | null> {
  const row = await db.prepare(
    `SELECT source_id, consecutive_failures, paused_until, last_failure_kind
     FROM source_health WHERE source_id = ?`,
  ).bind(sourceId).first<{ source_id: string; consecutive_failures: number; paused_until: string | null; last_failure_kind: string | null }>();
  return row ? {
    sourceId: row.source_id,
    consecutiveFailures: row.consecutive_failures,
    pausedUntil: row.paused_until,
    lastFailureKind: row.last_failure_kind,
  } : null;
}

export async function pausedSourceIds(db: D1Database, now: Date): Promise<Set<string>> {
  const rows = await db.prepare(
    "SELECT source_id FROM source_health WHERE paused_until IS NOT NULL AND paused_until > ?",
  ).bind(now.toISOString()).all<{ source_id: string }>();
  return new Set(rows.results.map((row) => row.source_id));
}

export async function recordSourceSuccess(db: D1Database, sourceId: string, now: Date): Promise<void> {
  await db.prepare(
    `INSERT INTO source_health (source_id, consecutive_failures, last_failure_kind, paused_until, updated_at)
     VALUES (?, 0, NULL, NULL, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       consecutive_failures = 0, last_failure_kind = NULL, paused_until = NULL, updated_at = excluded.updated_at`,
  ).bind(sourceId, now.toISOString()).run();
}

export async function recordSourceTerminalFailure(
  db: D1Database,
  sourceId: string,
  failureKind: string,
  now: Date,
): Promise<SourceHealth> {
  const existing = await getSourceHealth(db, sourceId);
  const consecutiveFailures = (existing?.consecutiveFailures ?? 0) + 1;
  const pausedUntil = consecutiveFailures >= FAILURE_THRESHOLD
    ? new Date(now.getTime() + PAUSE_MS).toISOString()
    : null;
  await db.prepare(
    `INSERT INTO source_health (source_id, consecutive_failures, last_failure_kind, paused_until, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       consecutive_failures = excluded.consecutive_failures,
       last_failure_kind = excluded.last_failure_kind,
       paused_until = excluded.paused_until,
       updated_at = excluded.updated_at`,
  ).bind(sourceId, consecutiveFailures, failureKind, pausedUntil, now.toISOString()).run();
  return { sourceId, consecutiveFailures, pausedUntil, lastFailureKind: failureKind };
}
