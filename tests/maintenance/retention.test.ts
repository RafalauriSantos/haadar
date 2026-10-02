import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runRetention } from "../../src/maintenance/retention";
import { recordSourceCanarySnapshot } from "../../src/storage/source-canary";
import worker from "../../src/index";

const now = new Date("2026-10-08T03:30:00.000Z");
const expired = new Date("2026-01-01T00:00:00.000Z");
const policy = { operationalEventsDays: 30, obsoleteObservationsDays: 14, batchSize: 99, maxBatches: 9 };

async function seedExpiredRows(count: number) {
  for (let offset = 0; offset < count; offset += 100) {
    await env.DB.batch(Array.from({ length: Math.min(100, count - offset) }, (_, index) => env.DB.prepare(
      "INSERT INTO operational_events (event_key, event_type, payload_json, created_at) VALUES (?, 'diagnostic', '{}', ?)",
    ).bind(`expired-event-${offset + index}`, expired.toISOString())));
    await env.DB.batch(Array.from({ length: Math.min(100, count - offset) }, (_, index) => env.DB.prepare(
      "INSERT INTO source_canary_samples (task_id, source_key, round_id, observed_count, observed_at) VALUES (?, 'retention-source', 'retention-round', 10, ?)",
    ).bind(`expired-task-${offset + index}`, expired.toISOString())));
  }
}

describe("bounded multi-batch retention", () => {
  beforeEach(async () => {
    await env.DB.batch([env.DB.prepare("DELETE FROM operational_events"), env.DB.prepare("DELETE FROM source_canary_samples")]);
  });

  it("processes nine batches to exceed daily collection volume and stops at its cap", async () => {
    await seedExpiredRows(925);
    expect(await runRetention(env.DB, policy, { now })).toEqual({ dryRun: false, operationalEvents: 891, sourceCanarySamples: 891, observations: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_events").first()).toEqual({ count: 34 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first()).toEqual({ count: 34 });
  });

  it("dry-runs the full bounded capacity without repeatedly counting the first batch", async () => {
    await seedExpiredRows(175);
    expect(await runRetention(env.DB, { ...policy, batchSize: 50, maxBatches: 3 }, { now, dryRun: true }))
      .toEqual({ dryRun: true, operationalEvents: 150, sourceCanarySamples: 150, observations: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_events").first()).toEqual({ count: 175 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first()).toEqual({ count: 175 });
  });

  it.each([
    { maxBatches: 0 }, { maxBatches: -1 }, { maxBatches: 1.5 }, { maxBatches: Infinity }, { maxBatches: 10 },
    { batchSize: 101 }, { batchSize: 100, maxBatches: 9 },
  ])("rejects an unbounded or Free Tier unsafe policy: %j", async (overrides) => {
    await expect(runRetention(env.DB, { ...policy, ...overrides }, { now })).rejects.toThrow(RangeError);
  });

  it("deletes a 100-row event batch in chunks with the cutoff binding", async () => {
    await seedExpiredRows(100);
    expect(await runRetention(env.DB, { ...policy, batchSize: 100, maxBatches: 1 }, { now }))
      .toEqual({ dryRun: false, operationalEvents: 100, sourceCanarySamples: 100, observations: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_events").first()).toEqual({ count: 0 });
  });

  it("preserves both rows of an atomic canary refreshed after retention selects the old snapshot", async () => {
    const snapshot = {
      sourceKey: "racing-source", roundId: "retention-round", queryId: "board:racing-source", adapterId: "racing-adapter",
      policy: { minimumBaselineSamples: 1, baselineWindow: 3, anomalyAtOrBelow: 0 },
    };
    await recordSourceCanarySnapshot(env.DB, { ...snapshot, taskId: "refreshed-snapshot", observedCount: 0, now: expired });
    await recordSourceCanarySnapshot(env.DB, { ...snapshot, taskId: "expired-snapshot", observedCount: 10, now: expired });
    let refreshed = false;
    const interleavedDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query);
        if (!query.includes("SELECT o.id FROM observations")) return statement;
        return { bind(...bindings: unknown[]) { return { async all() {
          if (!refreshed) {
            refreshed = true;
            await recordSourceCanarySnapshot(env.DB, { ...snapshot, taskId: "refreshed-snapshot", observedCount: 11, now });
          }
          return statement.bind(...bindings).all();
        } }; } };
      },
    } as unknown as D1Database;
    expect(await runRetention(interleavedDb, { ...policy, maxBatches: 1 }, { now }))
      .toEqual({ dryRun: false, operationalEvents: 1, sourceCanarySamples: 1, observations: 0 });
    expect(await env.DB.prepare("SELECT observed_count, observed_at FROM source_canary_samples WHERE task_id = 'refreshed-snapshot'").first())
      .toEqual({ observed_count: 11, observed_at: now.toISOString() });
    const event = await env.DB.prepare("SELECT payload_json, created_at FROM operational_events WHERE event_key = 'task:refreshed-snapshot:canary'")
      .first<{ payload_json: string; created_at: string }>();
    expect(event?.created_at).toBe(now.toISOString());
    expect(JSON.parse(event!.payload_json)).toMatchObject({ state: "healthy", count: 11 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_events").first()).toEqual({ count: 1 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first()).toEqual({ count: 1 });
  });

  it("uses a separate 03:30 maintenance slot without hourly discovery or expired-task recovery", async () => {
    await seedExpiredRows(925);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO discovery_rounds (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at) VALUES ('retention-slot-round', 'retention-slot', ?, 'retention-v1', 'NORMAL', 'running', ?, ?)")
        .bind(expired.toISOString(), expired.toISOString(), expired.toISOString()),
      env.DB.prepare("INSERT INTO discovery_tasks (id, round_id, query_id, adapter_id, idempotency_key, status, created_at, updated_at, lease_token, lease_expires_at) VALUES ('retention-expired-task', 'retention-slot-round', 'q', 'test', 'retention-expired-task', 'running', ?, ?, 'expired', ?)")
        .bind(expired.toISOString(), expired.toISOString(), expired.toISOString()),
    ]);
    let sent = 0;
    const queries: string[] = [];
    const db = { prepare(query: string) { queries.push(query); return env.DB.prepare(query); }, batch: env.DB.batch.bind(env.DB) } as unknown as D1Database;
    await worker.scheduled({ scheduledTime: now.getTime(), cron: "*/5 * * * *", noRetry() {} } as ScheduledController,
      { DB: db, HAADAR_DISCOVERY: { async sendBatch() { sent += 1; } } } as never, createExecutionContext());
    expect(sent).toBe(0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first()).toEqual({ count: 34 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_events WHERE event_type = 'diagnostic'").first()).toEqual({ count: 34 });
    expect(await env.DB.prepare("SELECT status, lease_token FROM discovery_tasks WHERE id = 'retention-expired-task'").first())
      .toEqual({ status: "running", lease_token: "expired" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM discovery_rounds").first()).toEqual({ count: 1 });
    expect(queries.length).toBeLessThanOrEqual(40);
  });
});
