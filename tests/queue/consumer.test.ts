import { describe, expect, it } from "vitest";
import { FixtureAdapter } from "../../src/adapters/fixtures";
import { consume } from "../../src/queue/consumer";
import type { DiscoveryTaskMessage } from "../../src/queue/messages";

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

const message: DiscoveryTaskMessage = { id: "task-1", roundId: "round-1", queryId: "query-1", adapterId: "fixture", idempotencyKey: "task-key", attempt: 0 };

describe("Queue consumer", () => {
  it("persists observations before recording adapter diagnostics", async () => {
    const db = new FakeD1();
    const result = await consume({ db, batch: [message], adapters: { fixture: new FixtureAdapter() }, maxAttempts: 3 });
    expect(result.retryable).toEqual(["task-key"]);
    expect(db.executed.findIndex((call) => call.sql.includes("INSERT INTO observations"))).toBeLessThan(
      db.executed.findIndex((call) => call.sql.includes("operational_events"))
    );
  });

  it("does not process duplicate delivery in the same batch", async () => {
    const db = new FakeD1();
    const result = await consume({ db, batch: [message, message], adapters: { fixture: new FixtureAdapter() }, maxAttempts: 3 });
    expect(result.retryable).toEqual(["task-key"]);
    expect(db.executed.filter((call) => call.sql.includes("INSERT INTO observations"))).toHaveLength(2);
  });

  it("turns missing adapters into terminal outcomes", async () => {
    const db = new FakeD1();
    const result = await consume({ db, batch: [message], adapters: {}, maxAttempts: 3 });
    expect(result.terminal).toEqual(["task-key"]);
  });
});
