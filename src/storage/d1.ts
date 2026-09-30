import type { BudgetState, DiscoveryRound, DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import { idempotencyKey } from "../domain/ids";

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

interface RoundRow {
  id: string;
  round_slot: string;
  scheduled_at: string;
  portfolio_revision: string;
  budget_state: BudgetState;
  status: DiscoveryRound["status"];
}

export interface PersistedRoundPlan {
  round: DiscoveryRound;
  portfolio: { revision: string; queries: QueryDefinition[] };
}

export async function createOrGetRound(db: D1Database, round: DiscoveryRound): Promise<DiscoveryRound> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO discovery_rounds
      (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_slot) DO NOTHING`,
  ).bind(
    round.id,
    round.slot.key,
    round.slot.scheduledAt,
    round.portfolioRevision,
    round.budgetState,
    round.status,
    now,
    now,
  ).run();

  const persisted = await db.prepare(
    `SELECT id, round_slot, scheduled_at, portfolio_revision, budget_state, status
     FROM discovery_rounds WHERE round_slot = ?`,
  ).bind(round.slot.key).first<RoundRow>();
  if (!persisted) throw new Error("round was not persisted");
  return roundFromRow(persisted);
}

export async function persistRoundPlan(
  db: D1Database,
  input: {
    round: DiscoveryRound;
    portfolio: { revision: string; queries: QueryDefinition[] };
    snapshotHash: string;
    tasks: DiscoveryTask[];
    now: string;
  },
): Promise<PersistedRoundPlan> {
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO discovery_rounds
        (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(round_slot) DO NOTHING`,
    ).bind(
      input.round.id,
      input.round.slot.key,
      input.round.slot.scheduledAt,
      input.round.portfolioRevision,
      input.round.budgetState,
      input.round.status,
      input.now,
      input.now,
    ),
    db.prepare(
      `INSERT INTO portfolio_snapshots
        (round_id, revision, snapshot_hash, snapshot_json, created_at)
       SELECT id, ?, ?, ?, ? FROM discovery_rounds
       WHERE round_slot = ? AND portfolio_revision = ?
       ON CONFLICT(round_id) DO NOTHING`,
    ).bind(
      input.portfolio.revision,
      input.snapshotHash,
      JSON.stringify(input.portfolio),
      input.now,
      input.round.slot.key,
      input.portfolio.revision,
    ),
  ];

  for (const task of input.tasks) {
    statements.push(
      db.prepare(
        `INSERT INTO discovery_tasks
          (id, round_id, query_id, adapter_id, idempotency_key, attempt, status,
           created_at, updated_at, portfolio_snapshot_hash)
         SELECT ?, ps.round_id, ?, ?, ?, ?, 'pending', ?, ?, ps.snapshot_hash
         FROM portfolio_snapshots ps
         WHERE ps.round_id = ? AND ps.snapshot_hash = ?
         ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        task.id,
        task.queryId,
        task.adapterId,
        task.idempotencyKey,
        task.attempt,
        input.now,
        input.now,
        task.roundId,
        input.snapshotHash,
      ),
      db.prepare(
        `INSERT INTO task_publications (task_id, status, created_at, updated_at)
         SELECT id, 'pending', ?, ? FROM discovery_tasks WHERE id = ?
         ON CONFLICT(task_id) DO NOTHING`,
      ).bind(input.now, input.now, task.id),
    );
  }

  await db.batch(statements);
  const persisted = await db.prepare(
    `SELECT r.id, r.round_slot, r.scheduled_at, r.portfolio_revision, r.budget_state, r.status,
            ps.snapshot_json
     FROM discovery_rounds r
     JOIN portfolio_snapshots ps ON ps.round_id = r.id
     WHERE r.round_slot = ?`,
  ).bind(input.round.slot.key).first<RoundRow & { snapshot_json: string }>();
  if (!persisted) throw new Error("round plan was not persisted");
  return {
    round: roundFromRow(persisted),
    portfolio: JSON.parse(persisted.snapshot_json) as PersistedRoundPlan["portfolio"],
  };
}

export async function claimTaskPublications(
  db: D1Database,
  input: { roundId: string; now: string; leaseUntil: string; leaseToken: string },
): Promise<DiscoveryTask[]> {
  const claimed = await db.prepare(
    `UPDATE task_publications
     SET status = 'leased', lease_token = ?, lease_expires_at = ?,
         publish_attempts = publish_attempts + 1, updated_at = ?
     WHERE task_id IN (
       SELECT tp.task_id FROM task_publications tp
       JOIN discovery_tasks dt ON dt.id = tp.task_id
       WHERE dt.round_id = ?
         AND (tp.status = 'pending' OR (tp.status = 'leased' AND tp.lease_expires_at <= ?))
     )
     RETURNING task_id`,
  ).bind(input.leaseToken, input.leaseUntil, input.now, input.roundId, input.now)
    .all<{ task_id: string }>();
  if (claimed.results.length === 0) return [];

  const placeholders = claimed.results.map(() => "?").join(",");
  const tasks = await db.prepare(
    `SELECT id, round_id, query_id, adapter_id, idempotency_key, attempt
     FROM discovery_tasks WHERE id IN (${placeholders}) ORDER BY id`,
  ).bind(...claimed.results.map((row) => row.task_id)).all<{
    id: string;
    round_id: string;
    query_id: string;
    adapter_id: string;
    idempotency_key: string;
    attempt: number;
  }>();
  return tasks.results.map((task) => ({
    id: task.id,
    roundId: task.round_id,
    queryId: task.query_id,
    adapterId: task.adapter_id,
    idempotencyKey: task.idempotency_key,
    attempt: task.attempt,
    publicationLeaseToken: input.leaseToken,
  }));
}

export async function markTaskPublished(
  db: D1Database,
  taskId: string,
  leaseToken: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE task_publications
     SET status = 'published', published_at = ?, updated_at = ?, lease_expires_at = NULL
     WHERE task_id = ? AND status = 'leased' AND lease_token = ?`,
  ).bind(now, now, taskId, leaseToken).run();
  return result.meta.changes === 1;
}

export async function createTaskIfAbsent(db: D1DatabaseLike, task: DiscoveryTask): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO discovery_tasks
      (id, round_id, query_id, adapter_id, idempotency_key, attempt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`,
  ).bind(task.id, task.roundId, task.queryId, task.adapterId, task.idempotencyKey, task.attempt, now, now).run();
}

export async function insertObservationFirst(db: D1DatabaseLike, observation: NormalizedObservation): Promise<void> {
  await db.prepare(
    `INSERT INTO observations
      (source_id, source_vacancy_id, canonical_url, title, organization, location, work_model,
       description_summary, published_at, observed_at, query_id, fingerprint, persisted_at, origin_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(canonical_url) DO NOTHING`,
  ).bind(
    observation.sourceId,
    observation.sourceVacancyId ?? null,
    observation.canonicalUrl,
    observation.title,
    observation.organization ?? null,
    observation.location ?? null,
    observation.workModel ?? "unknown",
    observation.descriptionSummary ?? null,
    observation.publishedAt ?? null,
    observation.observedAt,
    observation.queryId,
    observation.fingerprint,
    new Date().toISOString(),
    observation.originKind ?? "synthetic",
  ).run();
}

export interface OperationalEvent {
  eventKey: string;
  eventType: string;
  roundId?: string;
  taskId?: string;
  queryId?: string;
  adapterId?: string;
  payload: Record<string, unknown>;
}

export async function recordOperationalEvent(db: D1DatabaseLike, event: OperationalEvent): Promise<void> {
  await db.prepare(
    `INSERT INTO operational_events
      (event_key, event_type, round_id, task_id, query_id, adapter_id, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_key) DO NOTHING`,
  ).bind(
    event.eventKey,
    event.eventType,
    event.roundId ?? null,
    event.taskId ?? null,
    event.queryId ?? null,
    event.adapterId ?? null,
    JSON.stringify(event.payload),
    new Date().toISOString(),
  ).run();
}

export async function persistCanonicalObservation(db: D1Database, observation: NormalizedObservation): Promise<string> {
  const now = new Date().toISOString();
  const sourceIdentity = observation.sourceVacancyId
    ? await db.prepare(
        `SELECT vacancy_id FROM vacancy_source_identities
         WHERE source_id = ? AND source_vacancy_id = ?`,
      ).bind(observation.sourceId, observation.sourceVacancyId).first<{ vacancy_id: string }>()
    : null;
  const byUrl = await db.prepare("SELECT id FROM vacancies WHERE canonical_url = ?")
    .bind(observation.canonicalUrl).first<{ id: string }>();
  const byFingerprint = await db.prepare(
    "SELECT id FROM vacancies WHERE fingerprint_version = ? AND fingerprint = ? ORDER BY created_at LIMIT 1",
  ).bind(observation.fingerprintVersion ?? "v1", observation.fingerprint).first<{ id: string }>();
  const vacancyId = sourceIdentity?.vacancy_id ?? byUrl?.id ?? byFingerprint?.id ?? await idempotencyKey([
    "vacancy",
    observation.sourceId,
    observation.sourceVacancyId ?? observation.canonicalUrl,
  ]);

  await db.batch([
    db.prepare(
      `INSERT INTO vacancies
        (id, canonical_url, title, organization, location, work_model, description_summary,
         published_at, fingerprint, fingerprint_version, first_observed_at, last_observed_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_observed_at = excluded.last_observed_at,
         updated_at = excluded.updated_at`,
    ).bind(
      vacancyId,
      observation.canonicalUrl,
      observation.title,
      observation.organization ?? null,
      observation.location ?? null,
      observation.workModel ?? "unknown",
      observation.descriptionSummary ?? null,
      observation.publishedAt ?? null,
      observation.fingerprint,
      observation.fingerprintVersion ?? "v1",
      observation.observedAt,
      observation.observedAt,
      now,
      now,
    ),
    ...(observation.sourceVacancyId ? [db.prepare(
      `INSERT INTO vacancy_source_identities
        (source_id, source_vacancy_id, vacancy_id, first_observed_at, last_observed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id, source_vacancy_id) DO UPDATE SET
         last_observed_at = excluded.last_observed_at`,
    ).bind(
      observation.sourceId,
      observation.sourceVacancyId,
      vacancyId,
      observation.observedAt,
      observation.observedAt,
    )] : []),
    db.prepare(
      `INSERT INTO vacancy_occurrences
        (vacancy_id, round_id, task_id, source_id, source_vacancy_id, query_id,
         observed_url, observed_at, origin_kind, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(vacancy_id, round_id, query_id, source_id) DO NOTHING`,
    ).bind(
      vacancyId,
      observation.roundId ?? null,
      observation.taskId ?? null,
      observation.sourceId,
      observation.sourceVacancyId ?? null,
      observation.queryId,
      observation.canonicalUrl,
      observation.observedAt,
      observation.originKind ?? "synthetic",
      JSON.stringify({
        canonicalUrl: observation.canonicalUrl,
        fingerprint: observation.fingerprint,
        fingerprintVersion: observation.fingerprintVersion ?? "v1",
      }),
      now,
    ),
  ]);

  await db.prepare(
    `INSERT INTO possible_duplicates (vacancy_id, candidate_vacancy_id, reason, created_at)
     SELECT ?, id, 'same_title_and_organization', ? FROM vacancies
     WHERE id <> ? AND lower(title) = lower(?)
       AND coalesce(lower(organization), '') = coalesce(lower(?), '')
       AND (fingerprint <> ? OR fingerprint_version <> ?)
     ON CONFLICT(vacancy_id, candidate_vacancy_id) DO NOTHING`,
  ).bind(
    vacancyId,
    now,
    vacancyId,
    observation.title,
    observation.organization ?? null,
    observation.fingerprint,
    observation.fingerprintVersion ?? "v1",
  ).run();
  return vacancyId;
}

function roundFromRow(row: RoundRow): DiscoveryRound {
  return {
    id: row.id,
    slot: { key: row.round_slot, scheduledAt: row.scheduled_at },
    portfolioRevision: row.portfolio_revision,
    budgetState: row.budget_state,
    status: row.status,
  };
}
