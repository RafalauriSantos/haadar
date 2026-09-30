import { FixtureAdapter } from "./adapters/fixtures";
import { consumeMessage } from "./queue/consumer";
import type { DiscoveryTaskMessage } from "./queue/messages";
import { parseMessage } from "./queue/messages";
import { admitRound } from "./discovery/round-coordinator";
import { markTaskPublished } from "./storage/d1";
import { reconcileExpiredTaskLeases } from "./storage/tasks";

export interface Env {
  DB?: D1Database;
  HAADAR_DISCOVERY?: Queue<DiscoveryTaskMessage>;
}

const worker = {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/health") {
      return Response.json({ service: "haadar", status: "ok" });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.DB || !env.HAADAR_DISCOVERY) throw new Error("D1 and Queue bindings are required for scheduled discovery");
    await reconcileExpiredTaskLeases(env.DB, new Date(controller.scheduledTime).toISOString());
    const admission = await admitRound({
      db: env.DB,
      scheduledAt: new Date(controller.scheduledTime),
      portfolio: {
        revision: "portfolio-v1",
        queries: [{
          id: "fixture-role-backend",
          revision: "1",
          family: "ROLE",
          terms: ["backend", "typescript"],
          exclusions: [],
          priority: 10,
          estimatedCost: 1,
          active: true
        }]
      },
      usage: { workersRequests: 0, queueOperations: 0, d1RowsRead: 0, d1RowsWritten: 0, workflowSteps: 0, aiNeurons: 0 },
      adapterIds: ["fixture"]
    });
    if (admission.tasks.length > 0) {
      await env.HAADAR_DISCOVERY.sendBatch(admission.tasks.map((task) => ({ body: task })));
      await Promise.all(admission.tasks.map(async (task) => {
        if (!task.publicationLeaseToken) throw new Error("publication lease token is required");
        const marked = await markTaskPublished(env.DB!, task.id, task.publicationLeaseToken);
        if (!marked) throw new Error(`publication lease lost for task ${task.id}`);
      }));
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!env.DB) throw new Error("D1 binding is required for queue consumption");
    for (const message of batch.messages) {
      const parsed = parseMessage(message.body);
      if (!parsed.ok) {
        await env.DB.prepare(
          `INSERT INTO operational_events (event_key, event_type, payload_json, created_at)
           VALUES (?, 'queue_message_terminal', ?, ?)
           ON CONFLICT(event_key) DO NOTHING`,
        ).bind(
          `queue-message:${message.id}:invalid`,
          JSON.stringify({ reason: parsed.reason, attempts: message.attempts }),
          new Date().toISOString(),
        ).run();
        message.ack();
        continue;
      }
      try {
        const outcome = await consumeMessage({
          db: env.DB,
          task: parsed.value,
          queueAttempts: message.attempts,
          adapters: { fixture: new FixtureAdapter() },
          maxAttempts: 4,
        });
        if (outcome.action === "ack") message.ack();
        else message.retry({ delaySeconds: outcome.delaySeconds });
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  }
};

export default worker;
