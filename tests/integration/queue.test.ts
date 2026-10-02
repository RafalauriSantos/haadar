import { env } from "cloudflare:workers";
import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { AdapterDiagnostic, SourceAdapter } from "../../src/adapters/adapter";
import { admitRound } from "../../src/discovery/round-coordinator";
import { markTaskPublished } from "../../src/storage/d1";
import worker, { createAdapters } from "../../src/index";
import { consumeMessage, retryDelay } from "../../src/queue/consumer";
import { linkedinGuestSources } from "../../src/portfolio/sources";
import { parseMessage } from "../../src/queue/messages";
import { getSourceHealth, recordSourceTerminalFailure } from "../../src/storage/source-health";

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

function adapter(diagnostics: AdapterDiagnostic[] = []): SourceAdapter {
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
    const retryTask = await createTask("2026-10-03T01:30:00.000Z", "throttle-test");
    const retry = await consumeMessage({
      db: env.DB,
      task: retryTask,
      queueAttempts: 2,
      adapters: { "throttle-test": adapter([{ kind: "throttled", message: "remote body must not persist", httpStatus: 429 }]) },
      maxAttempts: 4,
      random: () => 0,
    });
    expect(retry).toEqual({ action: "ack", outcome: "terminal", reason: "throttled" });

    const terminal = await consumeMessage({
      db: env.DB,
      task: retryTask,
      queueAttempts: 4,
      adapters: { "throttle-test": adapter([{ kind: "throttled", message: "secret-like response" }]) },
      maxAttempts: 4,
    });
    expect(terminal).toMatchObject({ action: "ack", outcome: "already_terminal" });
    const stored = await env.DB.prepare("SELECT payload_json FROM operational_events WHERE task_id = ?")
      .bind(retryTask.id).all<{ payload_json: string }>();
    expect(JSON.stringify(stored.results)).not.toContain("secret-like response");
    expect(JSON.stringify(stored.results)).toContain("httpStatus\\\":429");
    expect(await getSourceHealth(env.DB, "throttle-test")).toMatchObject({ consecutiveFailures: 1 });
  });

  it("opens a shared source circuit immediately after throttling and prevents another request", async () => {
    const first = await createTask("2026-12-03T01:45:00.000Z", "linkedin-java");
    const throttled = await consumeMessage({
      db: env.DB,
      task: first,
      queueAttempts: 1,
      adapters: { "linkedin-java": adapter([{ kind: "throttled", message: "rate limited", httpStatus: 429 }]) },
      maxAttempts: 4,
      sourceHealthKey: "linkedin-guest",
      now: new Date("2026-12-03T01:45:00.000Z"),
    });
    expect(throttled).toMatchObject({ action: "ack", outcome: "terminal", reason: "throttled" });
    expect((await getSourceHealth(env.DB, "linkedin-guest"))?.pausedUntil).not.toBeNull();

    const next = await createTask("2026-12-03T02:46:00.000Z", "linkedin-node");
    let calls = 0;
    const result = await consumeMessage({
      db: env.DB,
      task: next,
      queueAttempts: 1,
      adapters: { "linkedin-node": { ...adapter(), id: "linkedin-node", async discover(task) { calls += 1; return adapter().discover(task); } } },
      maxAttempts: 4,
      sourceHealthKey: "linkedin-guest",
      now: new Date("2026-12-03T02:46:00.000Z"),
    });
    expect(result).toMatchObject({ action: "ack", outcome: "terminal", reason: "source_paused" });
    expect(calls).toBe(0);
  });

  it("pauses a blocked source immediately, while a later successful task clears its failure count", async () => {
    const task = await createTask("2026-12-04T00:00:00.000Z", "health-source");
    await consumeMessage({
      db: env.DB,
      task,
      queueAttempts: 1,
      adapters: { "health-source": adapter([{ kind: "blocked", message: "blocked" }]) },
      maxAttempts: 4,
      now: new Date("2026-12-04T00:00:00.000Z"),
    });
    expect(await getSourceHealth(env.DB, "health-source")).toMatchObject({ consecutiveFailures: 1 });
    expect(Date.parse((await getSourceHealth(env.DB, "health-source"))!.pausedUntil!)).toBeGreaterThan(Date.parse("2026-12-04T00:00:00.000Z"));

    const recovered = await createTask("2026-12-05T01:00:00.000Z", "health-source");
    await consumeMessage({ db: env.DB, task: recovered, queueAttempts: 1, adapters: { "health-source": adapter() }, maxAttempts: 4, now: new Date("2026-12-05T01:00:00.000Z") });
    expect(await getSourceHealth(env.DB, "health-source")).toMatchObject({ consecutiveFailures: 0, pausedUntil: null });
  });

  it("counts concurrent terminal failures without losing a source health update", async () => {
    const now = new Date("2026-10-04T04:00:00.000Z");
    await Promise.all(Array.from({ length: 3 }, () => recordSourceTerminalFailure(env.DB, "concurrent-source", "blocked", now)));
    expect(await getSourceHealth(env.DB, "concurrent-source")).toMatchObject({
      consecutiveFailures: 3,
      lastFailureKind: "blocked",
    });
  });

  it("accepts a silent manual task mode and rejects unknown delivery modes", async () => {
    const task = await createTask("2026-10-04T05:00:00.000Z", "test");
    expect(parseMessage({ ...task, deliveryMode: "silent" })).toMatchObject({ ok: true });
    expect(parseMessage({ ...task, deliveryMode: "loud" })).toEqual({ ok: false, reason: "invalid_schema" });
  });

  it("makes the protected manual endpoint silent unless notification is explicitly requested", async () => {
    const published: Array<{ body: { deliveryMode?: string } }> = [];
    const queue = { async sendBatch(items: Array<{ body: { deliveryMode?: string } }>) { published.push(...items); } };
    const ctx = createExecutionContext();
    const silent = await worker.fetch(
      new Request("https://haadar.test/admin/discovery?scheduledAt=2026-10-04T06:00:00.000Z", {
        method: "POST", headers: { authorization: "Bearer test-admin-token" },
      }),
      { DB: env.DB, HAADAR_DISCOVERY: queue, ADMIN_TRIGGER_TOKEN: "test-admin-token" } as never,
      ctx,
    );
    expect(silent.status).toBe(202);
    expect(await silent.json()).toMatchObject({ deliveryMode: "silent" });
    expect(published.length).toBeGreaterThan(0);
    expect(published.every((item) => item.body.deliveryMode === "silent")).toBe(true);

    const live = await worker.fetch(
      new Request("https://haadar.test/admin/discovery?scheduledAt=2026-10-04T07:00:00.000Z&notify=true", {
        method: "POST", headers: { authorization: "Bearer test-admin-token" },
      }),
      { DB: env.DB, HAADAR_DISCOVERY: queue, ADMIN_TRIGGER_TOKEN: "test-admin-token" } as never,
      createExecutionContext(),
    );
    expect(await live.json()).toMatchObject({ deliveryMode: "live" });
    expect(published.some((item) => item.body.deliveryMode === "live")).toBe(true);
  });

  it("republishes an expired task on the next scheduled run without changing its silent mode", async () => {
    const task = await createTask("2026-10-04T07:00:00.000Z", "test");
    await env.DB.prepare("UPDATE discovery_tasks SET delivery_mode = 'silent', status = 'running', lease_expires_at = ? WHERE id = ?")
      .bind("2026-10-04T07:04:00.000Z", task.id).run();
    await markTaskPublished(env.DB, task.id, task.publicationLeaseToken!);
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM discovery_rounds").first<{ count: number }>();

    const published: Array<{ body: { id: string; deliveryMode?: string } }> = [];
    const queue = { async sendBatch(items: Array<{ body: { id: string; deliveryMode?: string } }>) { published.push(...items); } };
    await worker.scheduled(
      { scheduledTime: Date.parse("2026-10-04T08:10:00.000Z"), cron: "*/5 * * * *", noRetry() {} } as ScheduledController,
      { DB: env.DB, HAADAR_DISCOVERY: queue } as never,
      createExecutionContext(),
    );

    expect(published).toContainEqual(expect.objectContaining({ body: expect.objectContaining({ id: task.id, deliveryMode: "silent" }) }));
    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM discovery_rounds").first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
    expect(await env.DB.prepare("SELECT event_type FROM operational_events WHERE event_key = ?")
      .bind("maintenance:2026-10-04T08:10:00.000Z").first()).toMatchObject({ event_type: "scheduled_maintenance" });
  });

  it.each(["permanent", "blocked", "schema_changed"] as const)("treats %s as terminal", async (kind) => {
    const minute = kind === "permanent" ? "03:00" : kind === "blocked" ? "04:30" : "06:00";
    const adapterId = `terminal-${kind}`;
    const task = await createTask(`2026-10-03T${minute}:00.000Z`, adapterId);
    const result = await consumeMessage({
      db: env.DB,
      task,
      queueAttempts: 1,
      adapters: { [adapterId]: adapter([{ kind, message: "detail" }]) },
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

  it("routes an active LinkedIn guest task to its adapter factory entry", async () => {
    const source = { ...linkedinGuestSources[0], active: true };
    const task = await createTask("2026-10-03T08:30:00.000Z", source.id);
    const result = await consumeMessage({
      db: env.DB,
      task,
      queueAttempts: 1,
      adapters: createAdapters([source], async () => new Response("<li></li>", { headers: { "content-type": "text/html" } })),
      maxAttempts: 4,
    });
    expect(result).toMatchObject({ action: "ack", outcome: "terminal", reason: "schema_changed" });
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
