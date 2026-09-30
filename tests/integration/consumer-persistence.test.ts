import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { FixtureAdapter } from "../../src/adapters/fixtures";
import { admitRound } from "../../src/discovery/round-coordinator";
import { consume } from "../../src/queue/consumer";

const usage = {
  workersRequests: 0,
  queueOperations: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  workflowSteps: 0,
  aiNeurons: 0,
};

async function createMessage(slot: string) {
  const admission = await admitRound({
    db: env.DB,
    scheduledAt: new Date(slot),
    portfolio: {
      revision: `consumer-${slot}`,
      queries: [{ id: "query-1", revision: "1", family: "ROLE", terms: ["backend"], exclusions: [], priority: 1, estimatedCost: 1, active: true }],
    },
    usage,
    adapterIds: ["fixture"],
    now: new Date(new Date(slot).getTime() + 1_000),
  });
  return admission.tasks[0];
}

describe("consumer persistence", () => {
  it("persists canonical vacancy and occurrence before diagnostics", async () => {
    const message = await createMessage("2026-10-02T00:00:00.000Z");
    const result = await consume({ db: env.DB, batch: [message], adapters: { fixture: new FixtureAdapter() }, maxAttempts: 3 });
    expect(result.retryable).toEqual([message.idempotencyKey]);

    const occurrence = await env.DB.prepare(
      "SELECT origin_kind FROM vacancy_occurrences WHERE task_id = ?",
    ).bind(message.id).first<{ origin_kind: string }>();
    expect(occurrence?.origin_kind).toBe("synthetic");
    const diagnostic = await env.DB.prepare(
      "SELECT event_type FROM operational_events WHERE task_id = ?",
    ).bind(message.id).first<{ event_type: string }>();
    expect(diagnostic?.event_type).toBe("adapter_diagnostic");
  });

  it("does not process duplicate delivery twice inside one batch", async () => {
    const message = await createMessage("2026-10-02T01:30:00.000Z");
    const result = await consume({ db: env.DB, batch: [message, message], adapters: { fixture: new FixtureAdapter() }, maxAttempts: 3 });
    expect(result.retryable).toEqual([message.idempotencyKey]);
    const occurrences = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM vacancy_occurrences WHERE task_id = ?",
    ).bind(message.id).first<{ count: number }>();
    expect(occurrences?.count).toBe(1);
  });

  it("turns missing adapters into terminal outcomes", async () => {
    const message = await createMessage("2026-10-02T03:00:00.000Z");
    const result = await consume({ db: env.DB, batch: [message], adapters: {}, maxAttempts: 3 });
    expect(result.terminal).toEqual([message.idempotencyKey]);
  });
});
