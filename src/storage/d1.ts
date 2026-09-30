import type { DiscoveryRound, DiscoveryTask, NormalizedObservation } from "../domain/types";

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
}

export async function createOrGetRound(db: D1DatabaseLike, round: DiscoveryRound): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO discovery_rounds
      (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(round_slot) DO NOTHING`
  ).bind(
    round.id,
    round.slot.key,
    round.slot.scheduledAt,
    round.portfolioRevision,
    round.budgetState,
    round.status,
    now,
    now
  ).run();
}

export async function createTaskIfAbsent(db: D1DatabaseLike, task: DiscoveryTask): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO discovery_tasks
      (id, round_id, query_id, adapter_id, idempotency_key, attempt, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(idempotency_key) DO NOTHING`
  ).bind(
    task.id,
    task.roundId,
    task.queryId,
    task.adapterId,
    task.idempotencyKey,
    task.attempt,
    now,
    now
  ).run();
}

export async function insertObservationFirst(
  db: D1DatabaseLike,
  observation: NormalizedObservation
): Promise<void> {
  await db.prepare(
    `INSERT INTO observations
      (source_id, source_vacancy_id, canonical_url, title, organization, location, work_model,
       description_summary, published_at, observed_at, query_id, fingerprint, persisted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(canonical_url) DO NOTHING`
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
    new Date().toISOString()
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
     ON CONFLICT(event_key) DO NOTHING`
  ).bind(
    event.eventKey,
    event.eventType,
    event.roundId ?? null,
    event.taskId ?? null,
    event.queryId ?? null,
    event.adapterId ?? null,
    JSON.stringify(event.payload),
    new Date().toISOString()
  ).run();
}
