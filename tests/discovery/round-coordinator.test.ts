import { describe, expect, it } from "vitest";
import { admitRound } from "../../src/discovery/round-coordinator";

class FakeStatement {
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]): FakeStatement { this.db.calls.push({ sql: this.sql, values }); return this; }
  async run(): Promise<void> { this.db.executed.push(this.db.calls.at(-1)!); }
}

class FakeD1 {
  calls: Array<{ sql: string; values: unknown[] }> = [];
  executed: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string): FakeStatement { return new FakeStatement(this, sql); }
}

const portfolio = {
  revision: "portfolio-1",
  queries: [
    { id: "role-1", revision: "1", family: "ROLE" as const, terms: ["backend"], exclusions: [], priority: 10, estimatedCost: 1, active: true },
    { id: "experimental-1", revision: "1", family: "EXPERIMENTAL" as const, terms: ["new"], exclusions: [], priority: 1, estimatedCost: 1, active: true }
  ]
};

const usage = { workersRequests: 0, queueOperations: 0, d1RowsRead: 0, d1RowsWritten: 0, workflowSteps: 0, aiNeurons: 0 };

describe("round coordinator", () => {
  it("creates one logical slot and bounded tasks", async () => {
    const db = new FakeD1();
    const first = await admitRound({ db, scheduledAt: new Date("2026-09-30T01:30:00.000Z"), portfolio, usage, adapterIds: ["fixture"] });
    const second = await admitRound({ db, scheduledAt: new Date("2026-09-30T01:30:00.000Z"), portfolio, usage, adapterIds: ["fixture"] });

    expect(first.round.id).toBe(second.round.id);
    expect(first.tasks).toHaveLength(2);
    expect(second.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id));
    expect(db.executed.filter((call) => call.sql.includes("discovery_rounds")).length).toBe(2);
  });

  it("excludes experimental queries when budget is essential", async () => {
    const db = new FakeD1();
    const result = await admitRound({ db, scheduledAt: new Date("2026-09-30T01:30:00.000Z"), portfolio, usage: { ...usage, queueOperations: 6_800 }, adapterIds: ["fixture"] });
    expect(result.budgetState).toBe("ESSENTIAL");
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].queryId).toBe("role-1");
  });

  it("defers all work in emergency mode", async () => {
    const db = new FakeD1();
    const result = await admitRound({ db, scheduledAt: new Date("2026-09-30T01:30:00.000Z"), portfolio, usage: { ...usage, queueOperations: 7_600 }, adapterIds: ["fixture"] });
    expect(result.budgetState).toBe("EMERGENCY");
    expect(result.tasks).toHaveLength(0);
  });
});
