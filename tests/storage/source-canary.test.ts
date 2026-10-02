import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSourceCanary } from "../../src/storage/source-canary";
import { defaultSourceCanaryPolicy } from "../../src/portfolio/source-contract";
import { runRetention } from "../../src/maintenance/retention";

const now = new Date("2026-10-06T12:00:00.000Z");
const sourceKey = "shared-upstream";

async function sample(taskId: string, observedCount: number, options: {
  sourceKey?: string;
  now?: Date;
  policy?: typeof defaultSourceCanaryPolicy;
} = {}) {
  return recordSourceCanary(env.DB, {
    sourceKey: options.sourceKey ?? sourceKey,
    taskId,
    roundId: "canary-round",
    observedCount,
    policy: options.policy ?? defaultSourceCanaryPolicy,
    now: options.now ?? now,
  });
}

async function seed(counts: number[]) {
  for (const [index, count] of counts.entries()) {
    await sample(`baseline-${index}`, count, { now: new Date(now.getTime() - (counts.length - index) * 60_000) });
  }
}

describe("persisted source canary", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM source_canary_samples").run();
  });

  it("warms up without counting the current observation in its baseline", async () => {
    expect(await sample("first-task", 0)).toEqual({ state: "warming", observedCount: 0, baselineMedian: null, sampleSize: 0 });
    await sample("second-task", 10);
    expect(await sample("third-task", 0)).toEqual({ state: "warming", observedCount: 0, baselineMedian: 5, sampleSize: 2 });
  });

  it("reports a healthy count near the prior median", async () => {
    await seed([8, 12, 10]);
    expect(await sample("healthy-task", 9)).toEqual({ state: "healthy", observedCount: 9, baselineMedian: 10, sampleSize: 3 });
  });

  it("flags zero observations after a positive baseline", async () => {
    await seed([8, 12, 10]);
    expect(await sample("empty-task", 0)).toEqual({ state: "anomalous", observedCount: 0, baselineMedian: 10, sampleSize: 3 });
  });

  it("does not call an established zero median anomalous", async () => {
    await seed([0, 0, 0]);
    expect(await sample("empty-task", 0)).toEqual({ state: "healthy", observedCount: 0, baselineMedian: 0, sampleSize: 3 });
  });

  it("uses the configured inclusive anomaly threshold", async () => {
    await seed([8, 12, 10]);
    expect(await sample("threshold-task", 2, {
      policy: { minimumBaselineSamples: 3, baselineWindow: 10, anomalyAtOrBelow: 2 },
    })).toMatchObject({ state: "anomalous", baselineMedian: 10 });
  });

  it("limits the baseline to the latest configured window and averages its middle pair", async () => {
    await seed([100, 200, 4, 8, 2, 6]);
    expect(await sample("window-task", 5, {
      policy: { minimumBaselineSamples: 3, baselineWindow: 4, anomalyAtOrBelow: 0 },
    })).toEqual({ state: "healthy", observedCount: 5, baselineMedian: 5, sampleSize: 4 });
  });

  it("isolates independent source keys", async () => {
    await seed([8, 12, 10]);
    expect(await sample("other-source-task", 0, { sourceKey: "independent-upstream" }))
      .toEqual({ state: "warming", observedCount: 0, baselineMedian: null, sampleSize: 0 });
  });

  it("overwrites a task sample while excluding that task from its replay baseline", async () => {
    await seed([8, 12, 10]);
    await sample("replayed-task", 0);
    expect(await sample("replayed-task", 11))
      .toEqual({ state: "healthy", observedCount: 11, baselineMedian: 10, sampleSize: 3 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first())
      .toEqual({ count: 4 });
    expect(await env.DB.prepare("SELECT source_key, round_id, observed_count, observed_at FROM source_canary_samples WHERE task_id = ?")
      .bind("replayed-task").first()).toEqual({
        source_key: sourceKey, round_id: "canary-round", observed_count: 11, observed_at: now.toISOString(),
      });
  });

  it("does not alter source health or write operational events", async () => {
    await seed([8, 12, 10]);
    await sample("anomaly-task", 0);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_health").first()).toEqual({ count: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM operational_events").first()).toEqual({ count: 0 });
  });

  it("preserves a sample refreshed by replay after retention selected it for deletion", async () => {
    const expired = new Date("2026-01-01T00:00:00.000Z");
    await sample("refreshed-task", 10, { now: expired });
    await sample("expired-task", 20, { now: expired });
    // Delegate every query to real D1; interleave the actual replay after candidate selection.
    const interleavedDb = {
      prepare(query: string) {
        const statement = env.DB.prepare(query);
        if (!query.includes("SELECT o.id FROM observations")) return statement;
        return {
          bind(...bindings: unknown[]) {
            return {
              async all() {
                await sample("refreshed-task", 11);
                return statement.bind(...bindings).all();
              },
            };
          },
        };
      },
    } as unknown as D1Database;

    const result = await runRetention(interleavedDb,
      { operationalEventsDays: 7, obsoleteObservationsDays: 7, batchSize: 10 }, { now });
    expect(await env.DB.prepare("SELECT observed_count, observed_at FROM source_canary_samples WHERE task_id = ?")
      .bind("refreshed-task").first()).toEqual({ observed_count: 11, observed_at: now.toISOString() });
    expect(await env.DB.prepare("SELECT task_id FROM source_canary_samples WHERE task_id = ?")
      .bind("expired-task").first()).toBeNull();
    expect(result.sourceCanarySamples).toBe(1);
  });

  it("deletes 100 expired samples at batchSize 100 without exceeding D1's parameter limit", async () => {
    await env.DB.batch(Array.from({ length: 100 }, (_, index) => env.DB.prepare(
      `INSERT INTO source_canary_samples (task_id, source_key, round_id, observed_count, observed_at)
       VALUES (?, 'retention-source', 'retention-round', 10, '2026-01-01T00:00:00.000Z')`,
    ).bind(`expired-task-${index}`)));

    const result = await runRetention(env.DB,
      { operationalEventsDays: 7, obsoleteObservationsDays: 7, batchSize: 100 }, { now });
    expect(result.sourceCanarySamples).toBe(100);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM source_canary_samples").first()).toEqual({ count: 0 });
  });
});
