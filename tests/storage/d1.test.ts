import { describe, expect, it } from "vitest";
import type { DiscoveryRound, DiscoveryTask, NormalizedObservation } from "../../src/domain/types";
import { createOrGetRound, createTaskIfAbsent, insertObservationFirst, recordOperationalEvent } from "../../src/storage/d1";

class FakeStatement {
  constructor(private readonly db: FakeD1, private readonly sql: string) {}

  bind(...values: unknown[]): FakeStatement {
    this.db.calls.push({ sql: this.sql, values });
    return this;
  }

  async run(): Promise<void> {
    this.db.executed.push(this.db.calls.at(-1)!);
  }
}

class FakeD1 {
  calls: Array<{ sql: string; values: unknown[] }> = [];
  executed: Array<{ sql: string; values: unknown[] }> = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
}

const round: DiscoveryRound = {
  id: "round-1",
  slot: { key: "2026-09-30T01:30Z", scheduledAt: "2026-09-30T01:30:00.000Z" },
  portfolioRevision: "portfolio-1",
  budgetState: "NORMAL",
  status: "planned"
};

const task: DiscoveryTask = {
  id: "task-1",
  roundId: "round-1",
  queryId: "query-1",
  adapterId: "fixture",
  idempotencyKey: "task-key",
  attempt: 0
};

const observation: NormalizedObservation = {
  sourceId: "fixture",
  sourceVacancyId: "vacancy-1",
  canonicalUrl: "https://jobs.example/vacancy-1",
  title: "Backend TypeScript Developer",
  observedAt: "2026-09-30T01:30:10.000Z",
  queryId: "query-1",
  fingerprint: "fingerprint-1"
};

describe("D1 repositories", () => {
  it("uses unique round and task keys for idempotent inserts", async () => {
    const db = new FakeD1();
    await createOrGetRound(db, round);
    await createOrGetRound(db, round);
    await createTaskIfAbsent(db, task);
    await createTaskIfAbsent(db, task);

    expect(db.executed).toHaveLength(4);
    expect(db.executed[0].sql).toContain("ON CONFLICT(round_slot) DO NOTHING");
    expect(db.executed[2].sql).toContain("ON CONFLICT(idempotency_key) DO NOTHING");
  });

  it("persists the observation through a dedicated first-write operation", async () => {
    const db = new FakeD1();
    await insertObservationFirst(db, observation);

    expect(db.executed[0].sql).toContain("INSERT INTO observations");
    expect(db.executed[0].sql).toContain("persisted_at");
    expect(db.executed[0].sql).toContain("ON CONFLICT(canonical_url) DO NOTHING");
  });

  it("deduplicates operational events by event key", async () => {
    const db = new FakeD1();
    await recordOperationalEvent(db, { eventKey: "event-1", eventType: "round_started", payload: {} });
    expect(db.executed[0].sql).toContain("ON CONFLICT(event_key) DO NOTHING");
  });
});
