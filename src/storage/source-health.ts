export interface SourceHealth {
  sourceId: string;
  consecutiveFailures: number;
  pausedUntil: string | null;
  lastFailureKind: string | null;
}

const FAILURE_THRESHOLD = 3;
const PAUSE_MS = 6 * 60 * 60_000;
const THROTTLE_PAUSE_MS = 3 * 60 * 60_000;
const CONTRACT_PAUSE_MS = 24 * 60 * 60_000;

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
  const immediatePause = failureKind === "throttled" || failureKind === "blocked" || failureKind === "schema_changed";
  const pauseMs = failureKind === "throttled"
    ? THROTTLE_PAUSE_MS
    : failureKind === "blocked" || failureKind === "schema_changed"
      ? CONTRACT_PAUSE_MS
      : PAUSE_MS;
  const pauseCandidate = new Date(now.getTime() + pauseMs).toISOString();
  const initialPause = immediatePause ? pauseCandidate : null;
  const row = await db.prepare(
    `INSERT INTO source_health (source_id, consecutive_failures, last_failure_kind, paused_until, updated_at)
     VALUES (?, 1, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       consecutive_failures = source_health.consecutive_failures + 1,
       last_failure_kind = excluded.last_failure_kind,
       paused_until = CASE
         WHEN ? = 1 OR source_health.consecutive_failures + 1 >= ? THEN ?
         ELSE NULL
       END,
       updated_at = excluded.updated_at
     RETURNING source_id, consecutive_failures, paused_until, last_failure_kind`,
  ).bind(sourceId, failureKind, initialPause, now.toISOString(), immediatePause ? 1 : 0, FAILURE_THRESHOLD, pauseCandidate).first<{
    source_id: string;
    consecutive_failures: number;
    paused_until: string | null;
    last_failure_kind: string | null;
  }>();
  if (!row) throw new Error("source health update did not return a row");
  return {
    sourceId: row.source_id,
    consecutiveFailures: row.consecutive_failures,
    pausedUntil: row.paused_until,
    lastFailureKind: row.last_failure_kind,
  };
}
