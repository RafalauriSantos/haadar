import { describe, expect, it } from "vitest";
import { emptyHealthSummary, recordUsage } from "../../src/observability/usage-ledger";

class FakeStatement {
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]): FakeStatement { this.db.executed.push({ sql: this.sql, values }); return this; }
  async run(): Promise<void> {}
}
class FakeD1 {
  executed: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string): FakeStatement { return new FakeStatement(this, sql); }
}

describe("usage ledger", () => {
  it("accounts by idempotent event key", async () => {
    const db = new FakeD1();
    await recordUsage(db, "usage-1", "2026-09-30", "queue_operations", 3);
    expect(db.executed[0].sql).toContain("ON CONFLICT(event_key) DO NOTHING");
  });

  it("starts with a safe unknown health summary", () => {
    expect(emptyHealthSummary().notificationHealth).toBe("unknown");
  });
});
