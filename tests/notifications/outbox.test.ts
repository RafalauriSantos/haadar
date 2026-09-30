import { describe, expect, it } from "vitest";
import { enqueueNotification } from "../../src/notifications/outbox";

class FakeStatement {
  constructor(private readonly db: FakeD1, private readonly sql: string) {}
  bind(...values: unknown[]): FakeStatement { this.db.executed.push({ sql: this.sql, values }); return this; }
  async run(): Promise<void> {}
}
class FakeD1 {
  executed: Array<{ sql: string; values: unknown[] }> = [];
  prepare(sql: string): FakeStatement { return new FakeStatement(this, sql); }
}

describe("notification outbox", () => {
  it("uses an idempotency key for notification creation", async () => {
    const db = new FakeD1();
    await enqueueNotification(db, { idempotencyKey: "alert-1", channel: "test", payload: { title: "Backend" } });
    expect(db.executed[0].sql).toContain("ON CONFLICT(idempotency_key) DO NOTHING");
  });
});
