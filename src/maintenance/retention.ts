export interface RetentionPolicy {
  operationalEventsDays: number;
  obsoleteObservationsDays: number;
  batchSize: number;
}

export interface RetentionResult {
  dryRun: boolean;
  operationalEvents: number;
  observations: number;
  sourceCanarySamples: number;
}

function validatePolicy(policy: RetentionPolicy): void {
  for (const value of [policy.operationalEventsDays, policy.obsoleteObservationsDays, policy.batchSize]) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError("retention policy values must be positive integers");
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
  const eventIds = await db.prepare(
    "SELECT id FROM operational_events WHERE created_at < ? ORDER BY id LIMIT ?",
  ).bind(eventCutoff, policy.batchSize).all<{ id: number }>();
  const canaryTaskIds = await db.prepare(
    "SELECT task_id FROM source_canary_samples WHERE observed_at < ? ORDER BY observed_at, task_id LIMIT ?",
  ).bind(eventCutoff, policy.batchSize).all<{ task_id: string }>();
  const observationIds = await db.prepare(
    `SELECT o.id FROM observations o
     WHERE o.observed_at < ? AND o.origin_kind = 'synthetic'
       AND NOT EXISTS (SELECT 1 FROM decisions d WHERE d.observation_id = o.id)
       AND NOT EXISTS (
         SELECT 1 FROM vacancy_occurrences vo
         JOIN decision_records dr ON dr.vacancy_id = vo.vacancy_id
         WHERE vo.vacancy_id = o.canonical_vacancy_id
       )
     ORDER BY o.id LIMIT ?`,
  ).bind(observationCutoff, policy.batchSize).all<{ id: number }>();
  if (options.dryRun) return {
    dryRun: true, operationalEvents: eventIds.results.length, observations: observationIds.results.length,
    sourceCanarySamples: canaryTaskIds.results.length,
  };
  if (eventIds.results.length > 0) {
    await db.prepare(`DELETE FROM operational_events WHERE id IN (${eventIds.results.map(() => "?").join(",")})`)
      .bind(...eventIds.results.map((row) => row.id)).run();
  }
  if (observationIds.results.length > 0) {
    await db.prepare(`DELETE FROM observations WHERE id IN (${observationIds.results.map(() => "?").join(",")})`)
      .bind(...observationIds.results.map((row) => row.id)).run();
  }
  if (canaryTaskIds.results.length > 0) {
    await db.prepare(`DELETE FROM source_canary_samples WHERE task_id IN (${canaryTaskIds.results.map(() => "?").join(",")})`)
      .bind(...canaryTaskIds.results.map((row) => row.task_id)).run();
  }
  return {
    dryRun: false, operationalEvents: eventIds.results.length, observations: observationIds.results.length,
    sourceCanarySamples: canaryTaskIds.results.length,
  };
}
