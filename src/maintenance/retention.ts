export interface RetentionPolicy {
  operationalEventsDays: number;
  obsoleteObservationsDays: number;
  batchSize: number;
  /** Defaults to one batch for existing callers. */
  maxBatches?: number;
}

/** 891 rows per table/day covers 432 canaries plus 288 maintenance events. */
export const dailyRetentionPolicy: RetentionPolicy = {
  operationalEventsDays: 30,
  obsoleteObservationsDays: 14,
  batchSize: 99,
  maxBatches: 9,
};

export interface RetentionResult {
  dryRun: boolean;
  operationalEvents: number;
  observations: number;
  sourceCanarySamples: number;
}

function validatePolicy(policy: RetentionPolicy): void {
  const maxBatches = policy.maxBatches ?? 1;
  for (const value of [policy.operationalEventsDays, policy.obsoleteObservationsDays, policy.batchSize, maxBatches]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("retention policy values must be positive safe integers");
  }
  // Reserve scheduled overhead below D1's 50-query Free Tier invocation limit.
  const maxQueries = 2 * maxBatches * (1 + Math.ceil(policy.batchSize / 99)) + 2;
  if (policy.batchSize > 100 || maxBatches > 9 || maxQueries > 38) {
    throw new RangeError("retention policy exceeds the bounded Free Tier query budget");
  }
}

export async function runRetention(
  db: D1Database,
  policy: RetentionPolicy,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<RetentionResult> {
  validatePolicy(policy);
  const now = options.now ?? new Date();
  const eventCutoff = new Date(now.getTime() - policy.operationalEventsDays * 86_400_000).toISOString();
  const observationCutoff = new Date(now.getTime() - policy.obsoleteObservationsDays * 86_400_000).toISOString();
  const maxBatches = policy.maxBatches ?? 1;
  const selectionLimit = options.dryRun ? policy.batchSize * maxBatches : policy.batchSize;
  const totals: RetentionResult = { dryRun: options.dryRun ?? false, operationalEvents: 0, observations: 0, sourceCanarySamples: 0 };
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const eventIds = await db.prepare(
      "SELECT id FROM operational_events WHERE created_at < ? ORDER BY id LIMIT ?",
    ).bind(eventCutoff, selectionLimit).all<{ id: number }>();
    const canaryTaskIds = await db.prepare(
      "SELECT task_id FROM source_canary_samples WHERE observed_at < ? ORDER BY observed_at, task_id LIMIT ?",
    ).bind(eventCutoff, selectionLimit).all<{ task_id: string }>();
    // Decision-protected observation cleanup remains one bounded batch per run.
    const observationIds = batch === 0 ? await db.prepare(
      `SELECT o.id FROM observations o
       WHERE o.observed_at < ? AND o.origin_kind = 'synthetic'
         AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.observation_id = o.id)
         AND NOT EXISTS (
           SELECT 1 FROM vacancy_occurrences vo
           JOIN decision_records dr ON dr.vacancy_id = vo.vacancy_id
           WHERE vo.vacancy_id = o.canonical_vacancy_id
         )
       ORDER BY o.id LIMIT ?`,
    ).bind(observationCutoff, policy.batchSize).all<{ id: number }>() : { results: [] };
    if (options.dryRun) return {
      dryRun: true, operationalEvents: eventIds.results.length, observations: observationIds.results.length,
      sourceCanarySamples: canaryTaskIds.results.length,
    };
    totals.operationalEvents += await deleteExpiredRows(db, "operational_events", eventIds.results.map((row) => row.id), eventCutoff);
    totals.sourceCanarySamples += await deleteExpiredRows(db, "source_canary_samples", canaryTaskIds.results.map((row) => row.task_id), eventCutoff);
    if (observationIds.results.length > 0) {
      const deleted = await db.prepare(`DELETE FROM observations WHERE id IN (${observationIds.results.map(() => "?").join(",")})`)
        .bind(...observationIds.results.map((row) => row.id)).run();
      totals.observations += deleted.meta.changes;
    }
    if (eventIds.results.length < policy.batchSize && canaryTaskIds.results.length < policy.batchSize) break;
  }
  return totals;
}

async function deleteExpiredRows(
  db: D1Database,
  table: "operational_events" | "source_canary_samples",
  ids: Array<string | number>,
  cutoff: string,
): Promise<number> {
  const idColumn = table === "operational_events" ? "id" : "task_id";
  const timestampColumn = table === "operational_events" ? "created_at" : "observed_at";
  let changes = 0;
  // D1 allows 100 bound parameters; reserve one for the expiration recheck.
  for (let offset = 0; offset < ids.length; offset += 99) {
    const chunk = ids.slice(offset, offset + 99);
    const deleted = await db.prepare(
      `DELETE FROM ${table} WHERE ${timestampColumn} < ?
       AND ${idColumn} IN (${chunk.map(() => "?").join(",")})`,
    ).bind(cutoff, ...chunk).run();
    changes += deleted.meta.changes;
  }
  return changes;
}
