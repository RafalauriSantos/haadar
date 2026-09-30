import { env } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { SourceAdapter } from "../../src/adapters/adapter";
import { admitRound } from "../../src/discovery/round-coordinator";
import worker from "../../src/index";
import { consumeMessage, retryDelay } from "../../src/queue/consumer";

const usage = { workersRequests: 0, queueOperations: 0, d1RowsRead: 0, d1RowsWritten: 0, workflowSteps: 0, aiNeurons: 0 };

async function createTask(slot: string, adapterId = "fixture") {
  const admission = await admitRound({
    db: env.DB,
    scheduledAt: new Date(slot),
    portfolio: {
      revision: `queue-${slot}-${adapterId}`,
      queries: [{ id: "query-1", revision: "1", family: "ROLE", terms: ["backend"], exclusions: [], priority: 1, estimatedCost: 1, active: true }],
    },
    usage,
    adapterIds: [adapterId],
    now: new Date(new Date(slot).getTime() + 1_000),
  });
  return admission.tasks[0];
}

function adapter(diagnostics: Array<{ kind: "retryable" | "permanent" | "throttled" | "blocked" | "schema_changed"; message: string }> = []): SourceAdapter {
  return {
    id: "test",
    async discover(task) {
      return {
        sourceId: "test",
        observations: [{
          sourceId: "test",
          sourceVacancyId: `vacancy-${task.id}`,
          canonicalUrl: `https://jobs.example/${task.id}`,
          title: "Backend Developer",
          observedAt: "2026-10-03T00:00:00.000Z",
          queryId: task.queryId,
          fingerprint: `fingerprint-${task.id}`,
        }],
        diagnostics,
      };
    },
  };
}

describe("persistent queue lifecycle", () => {
  it("completes once and acknowledges a later delivery without executing it", async () => {
    const task = await createTask("2026-10-03T00:00:00.000Z", "test");
    let calls = 0;
    const once = adapter();
    const counting: SourceAdapter = { ...once, async discover(value) { calls += 1; return once.discover(value); } };
    expect((await consumeMessage({ db: env.DB, task, queueAttempts: 1, adapters: { test: counting }, maxAttempts: 4 })).outcome).toBe("completed");
    expect((await consumeMessage({ db: env.DB, task, queueAttempts: 2, adapters: { test: counting }, maxAttempts: 4 })).outcome).toBe("already_terminal");
    expect(calls).toBe(1);
  });

  it("uses actual Queue attempts for throttling and terminal exhaustion", async () => {
    const retryTask = await createTask("2026-10-03T01:30:00.000Z", "test");
    const retry = await consumeMessage({
      db: env.DB,
      task: retryTask,
      queueAttempts: 2,
      adapters: { test: adapter([{ kind: "throttled", message: "remote body must not persist" }]) },
      maxAttempts: 4,
      random: () => 0,
    });
    expect(retry).toEqual({ action: "retry", outcome: "retryable", delaySeconds: 60 });

    const terminal = await consumeMessage({
      db: env.DB,
      task: retryTask,
      queueAttempts: 4,
      adapters: { test: adapter([{ kind: "throttled", message: "secret-like response" }]) },
      maxAttempts: 4,
    });
    expect(terminal).toMatchObject({ action: "ack", outcome: "terminal", reason: "attempts_exhausted" });
    const stored = await env.DB.prepare("SELECT payload_json FROM operational_events WHERE task_id = ?")
      .bind(retryTask.id).all<{ payload_json: string }>();
    expect(JSON.stringify(stored.results)).not.toContain("secret-like response");
  });

  it.each(["permanent", "blocked", "schema_changed"] as const)("treats %s as terminal", async (kind) => {
    const minute = kind === "permanent" ? "03:00" : kind === "blocked" ? "04:30" : "06:00";
    const task = await createTask(`2026-10-03T${minute}:00.000Z`, "test");
    const result = await consumeMessage({
      db: env.DB,
      task,
      queueAttempts: 1,
      adapters: { test: adapter([{ kind, message: "detail" }]) },
      maxAttempts: 4,
    });
    expect(result).toMatchObject({ action: "ack", outcome: "terminal", reason: kind });
  });

  it("acknowledges invalid messages and retries a valid failing message independently", async () => {
    const task = await createTask("2026-10-03T07:30:00.000Z");
    const batch = createMessageBatch<unknown>("haadar-discovery", [
      { id: "invalid", timestamp: new Date(), attempts: 1, body: { bad: true } },
      { id: "valid", timestamp: new Date(), attempts: 1, body: task },
    ]);
    const ctx = createExecutionContext();
    await worker.queue(batch, { DB: env.DB } as never, ctx);
    const result = await getQueueResult(batch, ctx);
    expect(result.explicitAcks).toContain("invalid");
    expect(result.explicitAcks).toContain("valid");
  });

  it("bounds exponential retry delay with jitter", () => {
    expect(retryDelay(1, () => 0)).toBe(30);
    expect(retryDelay(50, () => 0.999)).toBeLessThanOrEqual(900);
  });

  it("aggregates mixed task outcomes into a partial terminal round", async () => {
    const admission = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-03T09:00:00.000Z"),
      portfolio: {
        revision: "mixed-round-v1",
        queries: [{ id: "query-mixed", revision: "1", family: "ROLE", terms: ["backend"], exclusions: [], priority: 1, estimatedCost: 1, active: true }],
      },
      usage,
      adapterIds: ["test", "missing"],
      now: new Date("2026-10-03T09:01:00.000Z"),
    });
    const completed = admission.tasks.find((task) => task.adapterId === "test")!;
    const terminal = admission.tasks.find((task) => task.adapterId === "missing")!;
    await consumeMessage({ db: env.DB, task: completed, queueAttempts: 1, adapters: { test: adapter() }, maxAttempts: 4 });
    await consumeMessage({ db: env.DB, task: terminal, queueAttempts: 1, adapters: {}, maxAttempts: 4 });
    const round = await env.DB.prepare("SELECT status FROM discovery_rounds WHERE id = ?")
      .bind(admission.round.id).first<{ status: string }>();
    expect(round?.status).toBe("partial");
  });
});
