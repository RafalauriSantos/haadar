import type { SourceCanaryPolicy } from "../portfolio/source-contract";

export interface SourceCanaryInput {
  sourceKey: string;
  taskId: string;
  roundId: string;
  observedCount: number;
  policy: SourceCanaryPolicy;
  now: Date;
}

export interface SourceCanaryResult {
  state: "warming" | "healthy" | "anomalous";
  observedCount: number;
  baselineMedian: number | null;
  /** Number of prior samples used by the baseline, excluding the current task. */
  sampleSize: number;
}

export async function recordSourceCanary(db: D1Database, input: SourceCanaryInput): Promise<SourceCanaryResult> {
  // D1 batches execute serially in a transaction: capture the prior window before upserting.
  const [baseline] = await db.batch<{ observed_count: number }>([
    db.prepare(
      `SELECT observed_count FROM source_canary_samples
       WHERE source_key = ? AND task_id <> ?
       ORDER BY observed_at DESC, task_id DESC LIMIT ?`,
    ).bind(input.sourceKey, input.taskId, input.policy.baselineWindow),
    db.prepare(
      `INSERT INTO source_canary_samples (task_id, source_key, round_id, observed_count, observed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         source_key = excluded.source_key, round_id = excluded.round_id,
         observed_count = excluded.observed_count, observed_at = excluded.observed_at`,
    ).bind(input.taskId, input.sourceKey, input.roundId, input.observedCount, input.now.toISOString()),
  ]);
  const counts = baseline.results.map((row) => row.observed_count).sort((left, right) => left - right);
  const sampleSize = counts.length;
  const middle = Math.floor(sampleSize / 2);
  const baselineMedian = sampleSize === 0 ? null
    : sampleSize % 2 === 0 ? (counts[middle - 1] + counts[middle]) / 2 : counts[middle];
  const state = sampleSize < input.policy.minimumBaselineSamples ? "warming"
    : baselineMedian! > 0 && input.observedCount <= input.policy.anomalyAtOrBelow ? "anomalous" : "healthy";
  return { state, observedCount: input.observedCount, baselineMedian, sampleSize };
}
