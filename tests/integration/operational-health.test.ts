import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getOperationalHealth } from "../../src/observability/health";
import { runRetention } from "../../src/maintenance/retention";
import { getDiscoveryMetrics } from "../../src/observability/metrics";

const now = new Date("2026-10-06T12:00:00.000Z");

describe("operational health and retention", () => {
  it("derives its health fields from persisted D1 data", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO discovery_rounds
          (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
         VALUES ('health-round', '2026-10-06T10:30:00.000Z', ?, 'health-v1', 'CONSERVATIVE', 'partial', ?, ?)`,
      ).bind("2026-10-06T10:30:00.000Z", "2026-10-06T10:30:00.000Z", "2026-10-06T11:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO discovery_tasks
          (id, round_id, query_id, adapter_id, idempotency_key, status, created_at, updated_at)
         VALUES ('health-pending-task', 'health-round', 'role-backend', 'greenhouse', 'health-pending-task', 'pending', ?, ?)`,
      ).bind("2026-10-06T10:30:00.000Z", "2026-10-06T10:30:00.000Z"),
      env.DB.prepare(
        `INSERT INTO operational_events (event_key, event_type, round_id, adapter_id, payload_json, created_at)
         VALUES ('health-adapter-failure', 'adapter_diagnostic', 'health-round', 'greenhouse', '{"kind":"throttled"}', ?)`,
      ).bind("2026-10-06T11:00:00.000Z"),
    ]);

    const summary = await getOperationalHealth(env.DB, now);
    expect(summary.latestTerminalRound).toEqual({ id: "health-round", status: "partial", finishedAt: "2026-10-06T11:00:00.000Z" });
    expect(summary.roundsLast24Hours).toMatchObject({ expected: 16, observed: 1, terminal: 1, missing: 15 });
    expect(summary).toMatchObject({ budgetState: "CONSERVATIVE", failingAdapters: 1, oldestQueuedWork: "2026-10-06T10:30:00.000Z", notificationHealth: "unknown" });
  });

  it("dry-runs and batches retention without removing decision evidence", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO operational_events (event_key, event_type, payload_json, created_at)
         VALUES ('old-retention-event', 'diagnostic', '{}', '2026-01-01T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO observations
          (source_id, source_vacancy_id, canonical_url, title, work_model, observed_at, query_id, fingerprint, persisted_at, origin_kind)
         VALUES ('synthetic-source', 'discardable', 'https://example.test/discardable', 'Old synthetic', 'unknown', '2026-01-01T00:00:00.000Z', 'q', 'old-discardable', '2026-01-01T00:00:00.000Z', 'synthetic')`,
      ),
      env.DB.prepare(
        `INSERT INTO observations
          (source_id, source_vacancy_id, canonical_url, title, work_model, observed_at, query_id, fingerprint, persisted_at, origin_kind)
         VALUES ('synthetic-source', 'protected', 'https://example.test/protected', 'Protected evidence', 'unknown', '2026-01-01T00:00:00.000Z', 'q', 'old-protected', '2026-01-01T00:00:00.000Z', 'synthetic')`,
      ),
    ]);
    const protectedObservation = await env.DB.prepare("SELECT id FROM observations WHERE canonical_url = ?")
      .bind("https://example.test/protected").first<{ id: number }>();
    await env.DB.prepare(
      `INSERT INTO decisions (observation_id, rule_version, outcome, reason_code, created_at)
       VALUES (?, 'retention-v1', 'discard', 'audit_evidence', '2026-01-01T00:00:00.000Z')`,
    ).bind(protectedObservation!.id).run();

    const policy = { operationalEventsDays: 7, obsoleteObservationsDays: 7, batchSize: 10 };
    await expect(runRetention(env.DB, policy, { now, dryRun: true })).resolves.toEqual({ dryRun: true, operationalEvents: 1, observations: 1 });
    await expect(runRetention(env.DB, policy, { now })).resolves.toEqual({ dryRun: false, operationalEvents: 1, observations: 1 });
    expect(await env.DB.prepare("SELECT id FROM observations WHERE canonical_url = ?").bind("https://example.test/discardable").first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM observations WHERE canonical_url = ?").bind("https://example.test/protected").first()).not.toBeNull();
  });

  it("keeps synthetic fixtures out of discovery metrics", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO vacancies
          (id, canonical_url, title, work_model, fingerprint, fingerprint_version, first_observed_at, last_observed_at, created_at, updated_at)
         VALUES ('metric-vacancy', 'https://jobs.example/metric', 'Backend Developer', 'remote', 'metric-fingerprint', 'v1', ?, ?, ?, ?)`,
      ).bind("2026-10-06T10:00:00.000Z", "2026-10-06T10:00:00.000Z", "2026-10-06T10:00:00.000Z", "2026-10-06T10:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO vacancy_occurrences
          (vacancy_id, source_id, query_id, observed_url, observed_at, origin_kind, evidence_json, created_at)
         VALUES ('metric-vacancy', 'greenhouse-planetscale', 'role-backend', 'https://jobs.example/metric', ?, 'real', '{}', ?)`,
      ).bind("2026-10-06T10:00:00.000Z", "2026-10-06T10:00:00.000Z"),
    ]);
    const metrics = await getDiscoveryMetrics(env.DB, "2026-10-06T00:00:00.000Z");
    expect(metrics).toEqual([expect.objectContaining({ sourceId: "greenhouse-planetscale", queryId: "role-backend", rawOccurrences: 1, uniqueVacancies: 1, exclusiveVacancies: 1, eligible: 0 })]);
  });
});
