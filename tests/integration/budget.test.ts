import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { FreeFirstConfig } from "../../src/config";
import { estimateRoundCost, readUsageSnapshot, reserveRoundBudget, utcDay } from "../../src/budget/reservations";
import { recordUsage } from "../../src/observability/usage-ledger";

const tinyConfig: FreeFirstConfig = {
  ceilings: { workersRequests: 100, queueOperations: 10, d1RowsRead: 1_000, d1RowsWritten: 1_000, workflowSteps: 100, aiNeurons: 100 },
  reserveRatio: 0.1,
  conservativeRatio: 0.7,
  essentialRatio: 0.85,
  emergencyRatio: 0.9,
  maxTasksPerRound: 5,
  maxTasksPerSource: 5,
};

const cost = { workersRequests: 1, queueOperations: 6, d1RowsRead: 1, d1RowsWritten: 1, workflowSteps: 0, aiNeurons: 0 };

describe("persisted budget reservations", () => {
  it("allows only one contender for the final atomic reservation", async () => {
    const now = "2026-10-04T00:00:00.000Z";
    const results = await Promise.all([
      reserveRoundBudget(env.DB, { roundId: "budget-race-1", day: "2026-10-04", cost, now, reason: "test" }, tinyConfig),
      reserveRoundBudget(env.DB, { roundId: "budget-race-2", day: "2026-10-04", cost, now, reason: "test" }, tinyConfig),
    ]);
    expect(results.filter((result) => result.admitted)).toHaveLength(1);
  });

  it("deduplicates measured usage events and resets on the UTC day", async () => {
    await recordUsage(env.DB, "usage-dedupe-1", "2026-10-05", "queue_operations", 3);
    await recordUsage(env.DB, "usage-dedupe-1", "2026-10-05", "queue_operations", 3);
    expect((await readUsageSnapshot(env.DB, "2026-10-05")).queueOperations).toBe(3);
    expect((await readUsageSnapshot(env.DB, "2026-10-06")).queueOperations).toBe(0);
    expect(utcDay(new Date("2026-10-05T23:59:59.999-03:00"))).toBe("2026-10-06");
  });

  it("rejects invalid measurements and increases marginal cost with task count", async () => {
    await expect(recordUsage(env.DB, "usage-invalid", "2026-10-05", "queue_operations", Number.NaN)).rejects.toThrow(/finite/);
    expect(estimateRoundCost(5).queueOperations).toBeGreaterThan(estimateRoundCost(1).queueOperations);
  });
});
