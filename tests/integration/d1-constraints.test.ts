import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const round = {
  id: "round-integration-1",
  slot: "2026-09-30T00:00:00.000Z",
  now: "2026-09-30T00:01:00.000Z",
};

async function insertRound(id = round.id, slot = round.slot): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO discovery_rounds
      (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
     VALUES (?, ?, ?, 'integration-v1', 'NORMAL', 'planned', ?, ?)`,
  )
    .bind(id, slot, round.now, round.now, round.now)
    .run();
}

describe("D1 integration constraints", () => {
  it("executes the real migrations in an isolated local D1 database", async () => {
    const table = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'discovery_rounds'",
    ).first<{ name: string }>();

    expect(table?.name).toBe("discovery_rounds");
  });

  it("rejects a duplicate logical round slot", async () => {
    await insertRound();

    await expect(insertRound("round-integration-2", round.slot)).rejects.toThrow(
      /UNIQUE constraint failed: discovery_rounds\.round_slot/,
    );
  });

  it("enforces foreign keys", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO discovery_tasks
          (id, round_id, query_id, adapter_id, idempotency_key, status, created_at, updated_at)
         VALUES ('task-orphan', 'missing-round', 'query', 'adapter', 'orphan-key', 'pending', ?, ?)`,
      )
        .bind(round.now, round.now)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  it("rolls back every statement when a D1 batch contains a constraint violation", async () => {
    await expect(
      env.DB.batch([
        env.DB.prepare(
          `INSERT INTO discovery_rounds
            (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
           VALUES ('round-batch-1', '2026-09-30T01:30:00.000Z', ?, 'integration-v1', 'NORMAL', 'planned', ?, ?)`,
        ).bind(round.now, round.now, round.now),
        env.DB.prepare(
          `INSERT INTO discovery_rounds
            (id, round_slot, scheduled_at, portfolio_revision, budget_state, status, created_at, updated_at)
           VALUES ('round-batch-2', '2026-09-30T01:30:00.000Z', ?, 'integration-v1', 'NORMAL', 'planned', ?, ?)`,
        ).bind(round.now, round.now, round.now),
      ]),
    ).rejects.toThrow(/UNIQUE constraint failed/);

    const persisted = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM discovery_rounds WHERE id IN ('round-batch-1', 'round-batch-2')",
    ).first<{ count: number }>();

    expect(persisted?.count).toBe(0);
  });
});
