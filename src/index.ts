import { FixtureAdapter } from "./adapters/fixtures";
import { consume } from "./queue/consumer";
import type { DiscoveryTaskMessage } from "./queue/messages";
import { admitRound } from "./discovery/round-coordinator";
import { markTaskPublished } from "./storage/d1";

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

  async queue(batch: MessageBatch<DiscoveryTaskMessage>, env: Env): Promise<void> {
    if (!env.DB) throw new Error("D1 binding is required for queue consumption");
    await consume({
      db: env.DB,
      batch: batch.messages.map((message) => message.body),
      adapters: { fixture: new FixtureAdapter() },
      maxAttempts: 3
    });
  }
};

export default worker;
