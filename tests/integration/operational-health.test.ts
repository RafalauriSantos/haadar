import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getOperationalHealth } from "../../src/observability/health";
import { runRetention } from "../../src/maintenance/retention";
import { getDiscoveryMetrics } from "../../src/observability/metrics";
import { recordOperationalEvent } from "../../src/storage/d1";
import worker from "../../src/index";

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
    expect(summary.roundsLast24Hours).toMatchObject({ expected: 24, observed: 1, terminal: 1, missing: 23 });
    expect(summary).toMatchObject({
      budgetState: "CONSERVATIVE",
      failingAdapters: 1,
      anomalousSources: 0,
      oldestQueuedWork: "2026-10-06T10:30:00.000Z",
      notificationHealth: "unknown",
      expiredLeases: 0,
      pausedSources: 0,
      deliveryBacklog: 0,
    });
  });

  it("counts distinct anomalous source keys within 24 hours separately from adapter failures", async () => {
    const initial = await getOperationalHealth(env.DB, now);
    const events = [
      ["canary-a-1", "source_canary", "shared-a", "anomalous", "2026-10-06T10:00:00.000Z"],
      ["canary-a-2", "source_canary", "shared-a", "anomalous", "2026-10-06T11:00:00.000Z"],
      ["canary-b", "source_canary", "source-b", "anomalous", "2026-10-05T12:00:00.000Z"],
      ["canary-healthy", "source_canary", "healthy-source", "healthy", "2026-10-06T11:00:00.000Z"],
      ["canary-warming", "source_canary", "warming-source", "warming", "2026-10-06T11:00:00.000Z"],
      ["canary-old", "source_canary", "old-source", "anomalous", "2026-10-05T11:59:59.999Z"],
      ["failure", "adapter_diagnostic", "failing-source", "anomalous", "2026-10-06T11:00:00.000Z"],
    ];
    await env.DB.batch(events.map(([key, type, source, state, createdAt]) => env.DB.prepare(
      "INSERT INTO operational_events (event_key, event_type, adapter_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(key, type, `adapter-${key}`, JSON.stringify({ sourceKey: source, state, count: 0, baselineMedian: 10, sampleSize: 3 }), createdAt)));
    expect(await getOperationalHealth(env.DB, now)).toMatchObject({ anomalousSources: 2, failingAdapters: initial.failingAdapters + 1, pausedSources: 0 });
    const response = await worker.fetch(new Request("https://haadar.test/health/operations", {
      headers: { authorization: "Bearer health-token" },
    }), { DB: env.DB, OPERATIONS_TOKEN: "health-token" }, createExecutionContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("anomalousSources");
  });

  it("persists only finite numeric canary baseline metadata and omits upstream details", async () => {
    await recordOperationalEvent(env.DB, {
      eventKey: "canary-safe-payload", eventType: "source_canary", adapterId: "safe-source",
      payload: { sourceKey: "safe-source", state: "healthy", count: 4, baselineMedian: 10, sampleSize: 3,
        url: "https://private.example", body: "private response", message: "private detail" },
    });
    const saved = await env.DB.prepare("SELECT payload_json FROM operational_events WHERE event_key = 'canary-safe-payload'")
      .first<{ payload_json: string }>();
    expect(JSON.parse(saved!.payload_json)).toEqual({ sourceKey: "safe-source", state: "healthy", count: 4, baselineMedian: 10, sampleSize: 3 });
    await recordOperationalEvent(env.DB, {
      eventKey: "canary-unsafe-baseline", eventType: "source_canary", adapterId: "safe-source",
      payload: { sourceKey: "https://private.example", state: "warming", count: 0, baselineMedian: "private upstream text", sampleSize: Infinity },
    });
    const unsafe = await env.DB.prepare("SELECT payload_json FROM operational_events WHERE event_key = 'canary-unsafe-baseline'")
      .first<{ payload_json: string }>();
    expect(JSON.parse(unsafe!.payload_json)).toEqual({ state: "warming", count: 0 });
  });

  it("keeps unrelated operational events immutable when their keys are reused", async () => {
    const event = { eventKey: "immutable-event", eventType: "adapter_diagnostic", adapterId: "original-adapter", payload: { kind: "blocked" } };
    await recordOperationalEvent(env.DB, event);
    await recordOperationalEvent(env.DB, { ...event, adapterId: "changed-adapter", payload: { kind: "retryable" } });
    await recordOperationalEvent(env.DB, { ...event, eventType: "source_canary", payload: { sourceKey: "source", state: "healthy", count: 10 } });
    const saved = await env.DB.prepare("SELECT event_type, adapter_id, payload_json FROM operational_events WHERE event_key = ?")
      .bind(event.eventKey).first<{ event_type: string; adapter_id: string; payload_json: string }>();
    expect(saved).toEqual({ event_type: "adapter_diagnostic", adapter_id: "original-adapter", payload_json: JSON.stringify({ kind: "blocked" }) });
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
    await expect(runRetention(env.DB, policy, { now, dryRun: true })).resolves.toEqual({ dryRun: true, operationalEvents: 1, observations: 1, sourceCanarySamples: 0 });
    await expect(runRetention(env.DB, policy, { now })).resolves.toEqual({ dryRun: false, operationalEvents: 1, observations: 1, sourceCanarySamples: 0 });
    expect(await env.DB.prepare("SELECT id FROM observations WHERE canonical_url = ?").bind("https://example.test/discardable").first()).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM observations WHERE canonical_url = ?").bind("https://example.test/protected").first()).not.toBeNull();
  });

  it("dry-runs and deletes expired canary samples in bounded batches using event retention", async () => {
    const cutoff = "2026-09-29T12:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO source_canary_samples (source_key, task_id, round_id, observed_count, observed_at)
         VALUES ('retention-source', 'canary-expired-1', 'retention-round', 10, '2026-01-01T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO source_canary_samples (source_key, task_id, round_id, observed_count, observed_at)
         VALUES ('retention-source', 'canary-expired-2', 'retention-round', 20, '2026-01-02T00:00:00.000Z')`,
      ),
      env.DB.prepare(
        `INSERT INTO source_canary_samples (source_key, task_id, round_id, observed_count, observed_at)
         VALUES ('retention-source', 'canary-at-cutoff', 'retention-round', 30, ?)`,
      ).bind(cutoff),
      env.DB.prepare(
        `INSERT INTO source_canary_samples (source_key, task_id, round_id, observed_count, observed_at)
         VALUES ('retention-source', 'canary-recent', 'retention-round', 40, ?)`,
      ).bind(now.toISOString()),
    ]);
    const policy = { operationalEventsDays: 7, obsoleteObservationsDays: 1, batchSize: 1 };
    expect(await runRetention(env.DB, policy, { now, dryRun: true })).toMatchObject({ dryRun: true, sourceCanarySamples: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first()).toEqual({ count: 4 });
    expect(await runRetention(env.DB, policy, { now })).toMatchObject({ sourceCanarySamples: 1 });
    expect(await env.DB.prepare("SELECT task_id FROM source_canary_samples ORDER BY task_id").all())
      .toMatchObject({ results: [{ task_id: "canary-at-cutoff" }, { task_id: "canary-expired-2" }, { task_id: "canary-recent" }] });
    expect(await runRetention(env.DB, policy, { now })).toMatchObject({ sourceCanarySamples: 1 });
    expect(await runRetention(env.DB, policy, { now })).toMatchObject({ sourceCanarySamples: 0 });
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

  it("runs bounded retention from the daily maintenance slot", async () => {
    await env.DB.prepare(
      `INSERT INTO operational_events (event_key, event_type, payload_json, created_at)
       VALUES ('scheduled-retention-event', 'diagnostic', '{}', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const queue = { async sendBatch() {} };
    await worker.scheduled(
      { scheduledTime: Date.parse("2026-10-08T03:00:00.000Z"), cron: "*/5 * * * *", noRetry() {} } as ScheduledController,
      { DB: env.DB, HAADAR_DISCOVERY: queue } as never,
      createExecutionContext(),
    );
    expect(await env.DB.prepare("SELECT id FROM operational_events WHERE event_key = 'scheduled-retention-event'").first()).toBeNull();
  });
});
