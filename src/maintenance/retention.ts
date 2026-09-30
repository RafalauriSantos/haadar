import type { D1DatabaseLike } from "../storage/d1";

export interface RetentionPolicy {
  operationalEventsDays: number;
  obsoleteObservationsDays: number;
}

export async function runRetention(db: D1DatabaseLike, policy: RetentionPolicy, now = new Date()): Promise<void> {
  const eventCutoff = new Date(now.getTime() - policy.operationalEventsDays * 86_400_000).toISOString();
  const observationCutoff = new Date(now.getTime() - policy.obsoleteObservationsDays * 86_400_000).toISOString();
  await db.prepare("DELETE FROM operational_events WHERE created_at < ?").bind(eventCutoff).run();
  await db.prepare(
    `DELETE FROM observations
     WHERE observed_at < ?
       AND id NOT IN (SELECT observation_id FROM decisions)`
  ).bind(observationCutoff).run();
}
