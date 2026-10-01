import { GreenhouseAdapter } from "./adapters/greenhouse";
import { GitHubIssuesAdapter } from "./adapters/github-issues";
import { GupyAdapter } from "./adapters/gupy";
import { TramposAdapter } from "./adapters/trampos";
import { GoogleNewsRssAdapter } from "./adapters/rss";
import { consumeMessage } from "./queue/consumer";
import type { DiscoveryTaskMessage } from "./queue/messages";
import { parseMessage } from "./queue/messages";
import { admitRound } from "./discovery/round-coordinator";
import { markTaskPublished } from "./storage/d1";
import { reconcileExpiredTaskLeases } from "./storage/tasks";
import { recordUsage } from "./observability/usage-ledger";
import { utcDay } from "./budget/reservations";
import { getOperationalHealth } from "./observability/health";
import { createTelegramClient } from "./notifications/telegram";
import { dispatchOne } from "./notifications/dispatcher";
import { initialQueries } from "./portfolio/query-portfolio";
import { pilotSources } from "./portfolio/sources";
import type { EnrichmentWorkflowParams } from "./workflows/enrichment";

export { EnrichmentWorkflow } from "./workflows/enrichment";

export interface Env {
  DB?: D1Database;
  HAADAR_DISCOVERY?: Queue<DiscoveryTaskMessage>;
  ENRICHMENT_WORKFLOW?: Workflow<EnrichmentWorkflowParams>;
  OPERATIONS_TOKEN?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_DESTINATION?: string;
  ADMIN_TRIGGER_TOKEN?: string;
}

async function runDiscoveryRound(env: Env, scheduledAt: Date): Promise<{ roundId: string; admittedTasks: number }> {
  if (!env.DB || !env.HAADAR_DISCOVERY) throw new Error("D1 and Queue bindings are required for scheduled discovery");
  await reconcileExpiredTaskLeases(env.DB, scheduledAt.toISOString());
  const admission = await admitRound({
    db: env.DB,
    scheduledAt,
    portfolio: { revision: "portfolio-v2-greenhouse-pilot", queries: initialQueries },
    adapterIds: pilotSources.filter((source) => source.active).map((source) => source.id),
    boardOnceAdapters: true,
  });
  if (admission.tasks.length > 0) {
    await env.HAADAR_DISCOVERY.sendBatch(admission.tasks.map((task) => ({ body: task })));
    await Promise.all(admission.tasks.map(async (task) => {
      if (!task.publicationLeaseToken) throw new Error("publication lease token is required");
      const marked = await markTaskPublished(env.DB!, task.id, task.publicationLeaseToken);
      if (!marked) throw new Error(`publication lease lost for task ${task.id}`);
      await recordUsage(env.DB!, `task:${task.id}:queue-publish`, utcDay(scheduledAt), "queue_operations", 1);
    }));
  }
  return { roundId: admission.round.id, admittedTasks: admission.tasks.length };
}

const worker = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health") {
      return Response.json({ service: "haadar", status: "ok" });
    }
    if (pathname === "/health/operations") {
      if (!env.DB || !env.OPERATIONS_TOKEN || request.headers.get("authorization") !== `Bearer ${env.OPERATIONS_TOKEN}`) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.json(await getOperationalHealth(env.DB));
    }
    if (pathname === "/admin/discovery" && request.method === "POST") {
      if (!env.ADMIN_TRIGGER_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TRIGGER_TOKEN}`) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const requestedAt = new URL(request.url).searchParams.get("scheduledAt");
      const scheduledAt = requestedAt ? new Date(requestedAt) : new Date();
      if (Number.isNaN(scheduledAt.getTime())) return Response.json({ error: "invalid_scheduled_at" }, { status: 400 });
      return Response.json(await runDiscoveryRound(env, scheduledAt), { status: 202 });
    }
    if (pathname === "/admin/dispatch" && request.method === "POST") {
      if (!env.ADMIN_TRIGGER_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TRIGGER_TOKEN}`) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_DESTINATION) {
        return Response.json({ error: "delivery_not_configured" }, { status: 503 });
      }
      try {
        return Response.json({ delivery: await dispatchOne(env.DB, createTelegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_DESTINATION)) });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        console.error(JSON.stringify({ event: "admin_dispatch_failed", errorName }));
        return Response.json({ error: "dispatch_failed", errorName }, { status: 500 });
      }
    }
    if (pathname === "/admin/telegram-test" && request.method === "POST") {
      if (!env.ADMIN_TRIGGER_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TRIGGER_TOKEN}`) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_DESTINATION) {
        return Response.json({ error: "delivery_not_configured" }, { status: 503 });
      }
      const result = await createTelegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_DESTINATION).send(
        "Haadar: teste controlado do Worker para o canal de alertas.",
      );
      return Response.json({ delivery: result.kind });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDiscoveryRound(env, new Date(controller.scheduledTime));
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
        const adapters = Object.fromEntries(pilotSources.map((source) => [
          source.id,
          source.adapterId === "greenhouse"
            ? new GreenhouseAdapter(source, initialQueries)
            : source.adapterId === "github-issues"
              ? new GitHubIssuesAdapter(source, initialQueries)
              : source.adapterId === "gupy"
                ? new GupyAdapter(source, initialQueries)
                : source.adapterId === "trampos"
                  ? new TramposAdapter(source, initialQueries)
                  : new GoogleNewsRssAdapter(source, initialQueries),
        ]));
        const outcome = await consumeMessage({
          db: env.DB,
          task: parsed.value,
          queueAttempts: message.attempts,
          adapters,
          maxAttempts: 4,
          enrichmentWorkflow: env.ENRICHMENT_WORKFLOW,
          alertChannel: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_DESTINATION ? "telegram" : undefined,
          alertDestinationKey: env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_DESTINATION ? env.TELEGRAM_DESTINATION : undefined,
        });
        if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_DESTINATION) {
          await dispatchOne(env.DB, createTelegramClient(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_DESTINATION));
        }
        if (outcome.action === "ack") message.ack();
        else message.retry({ delaySeconds: outcome.delaySeconds });
      } catch {
        message.retry({ delaySeconds: 60 });
      }
    }
  }
};

export default worker;
