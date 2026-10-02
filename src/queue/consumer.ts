import { persistCanonicalObservation, recordOperationalEvent } from "../storage/d1";
import { claimTaskForExecution, finishTask } from "../storage/tasks";
import type { SourceAdapter } from "../adapters/adapter";
import type { DiscoveryTask } from "../domain/types";
import { recordUsage } from "../observability/usage-ledger";
import { utcDay } from "../budget/reservations";
import { evaluateAndPersist } from "../decision/pipeline";
import { initialQueries } from "../portfolio/query-portfolio";
import { defaultRelevanceProfile } from "../portfolio/sources";
import type { EnrichmentWorkflowParams } from "../workflows/enrichment";
import { getSourceHealth, recordSourceSuccess, recordSourceTerminalFailure } from "../storage/source-health";

export type ConsumeAction =
  | { action: "ack"; outcome: "completed" | "terminal" | "already_terminal"; reason?: string }
  | { action: "retry"; outcome: "retryable"; delaySeconds: number }
  | { action: "retry"; outcome: "busy"; delaySeconds: number };

export interface ConsumerInput {
  db: D1Database;
  task: DiscoveryTask;
  queueAttempts: number;
  adapters: Record<string, SourceAdapter>;
  maxAttempts: number;
  now?: Date;
  random?: () => number;
  enrichmentWorkflow?: Workflow<EnrichmentWorkflowParams>;
  alertChannel?: string;
  alertDestinationKey?: string;
  /** Multiple tasks that share an upstream contract can share one circuit. */
  sourceHealthKey?: string;
}

export async function consumeMessage(input: ConsumerInput): Promise<ConsumeAction> {
  const now = input.now ?? new Date();
  const leaseToken = crypto.randomUUID();
  const claim = await claimTaskForExecution(input.db, input.task, {
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 5 * 60_000).toISOString(),
    queueAttempts: input.queueAttempts,
    leaseToken,
  });
  if (claim.kind === "already_terminal") return { action: "ack", outcome: "already_terminal" };
  if (claim.kind === "busy") return { action: "retry", outcome: "busy", delaySeconds: 30 };
  await recordUsage(
    input.db,
    `task:${input.task.id}:queue-attempt:${input.queueAttempts}`,
    utcDay(now),
    "queue_operations",
    2,
  );
  await recordUsage(
    input.db,
    `task:${input.task.id}:worker-attempt:${input.queueAttempts}`,
    utcDay(now),
    "workers_requests",
    1,
  );

  const adapter = input.adapters[input.task.adapterId];
  if (!adapter) {
    await completeTerminal(input, leaseToken, now, "missing_adapter");
    return { action: "ack", outcome: "terminal", reason: "missing_adapter" };
  }
  const sourceHealthKey = input.sourceHealthKey ?? input.task.adapterId;
  const health = await getSourceHealth(input.db, sourceHealthKey);
  if (health?.pausedUntil && health.pausedUntil > now.toISOString()) {
    await completeTerminal(input, leaseToken, now, "source_paused", undefined, sourceHealthKey, false);
    return { action: "ack", outcome: "terminal", reason: "source_paused" };
  }

  try {
    const adapterResult = await adapter.discover(input.task);
    for (const observation of adapterResult.observations) {
      const persistedObservation = {
        ...observation,
        roundId: input.task.roundId,
        taskId: input.task.id,
        originKind: observation.originKind ?? "synthetic",
      };
      const vacancyId = await persistCanonicalObservation(input.db, persistedObservation);
      if (persistedObservation.originKind === "real") {
        const discoveryQuery = initialQueries.find((query) => query.id === observation.queryId);
        if (discoveryQuery) {
          const evaluation = await evaluateAndPersist(input.db, {
            vacancyId,
            observation: persistedObservation,
            discoveryQuery,
            profile: defaultRelevanceProfile,
            now,
            channel: input.alertChannel,
            destinationKey: input.alertDestinationKey,
          });
          if (evaluation.outcome === "alert" && input.enrichmentWorkflow) {
            const round = await input.db.prepare("SELECT budget_state FROM discovery_rounds WHERE id = ?")
              .bind(input.task.roundId).first<{ budget_state: "NORMAL" | "CONSERVATIVE" | "ESSENTIAL" | "EMERGENCY" }>();
            const instanceId = `enrichment-${vacancyId}`;
            try {
              await input.enrichmentWorkflow.create({
                id: instanceId,
                params: {
                  instanceId,
                  vacancyId,
                  decisionId: evaluation.decisionId,
                  candidate: {
                    title: observation.title,
                    organization: observation.organization,
                    descriptionSummary: observation.descriptionSummary,
                  },
                  budgetAllowed: round?.budget_state === "NORMAL" || round?.budget_state === "CONSERVATIVE",
                  aiEnabled: false,
                },
                retention: { successRetention: "1 day", errorRetention: "2 days" },
              });
            } catch {
              await input.enrichmentWorkflow.get(instanceId);
            }
          }
        }
      }
    }
    for (const diagnostic of adapterResult.diagnostics) {
      await recordOperationalEvent(input.db, {
        eventKey: `task:${input.task.id}:diagnostic:${diagnostic.kind}:${input.queueAttempts}`,
        eventType: "adapter_diagnostic",
        roundId: input.task.roundId,
        taskId: input.task.id,
        queryId: input.task.queryId,
        adapterId: input.task.adapterId,
        payload: { kind: diagnostic.kind, httpStatus: diagnostic.httpStatus ?? null },
      });
    }

    const terminalKind = adapterResult.diagnostics.find((item) =>
      item.kind === "permanent" || item.kind === "blocked" || item.kind === "schema_changed"
    )?.kind;
    if (terminalKind) {
      await completeTerminal(input, leaseToken, now, terminalKind, terminalKind, sourceHealthKey);
      return { action: "ack", outcome: "terminal", reason: terminalKind };
    }

    const retryKind = adapterResult.diagnostics.find((item) =>
      item.kind === "retryable" || item.kind === "throttled"
    )?.kind;
    if (retryKind) {
      if (retryKind === "throttled") {
        await completeTerminal(input, leaseToken, now, "throttled", retryKind, sourceHealthKey);
        return { action: "ack", outcome: "terminal", reason: "throttled" };
      }
      if (input.queueAttempts >= input.maxAttempts) {
        await completeTerminal(input, leaseToken, now, "attempts_exhausted", retryKind, sourceHealthKey);
        return { action: "ack", outcome: "terminal", reason: "attempts_exhausted" };
      }
      await finishTask(input.db, {
        taskId: input.task.id,
        leaseToken,
        status: "retryable",
        now: now.toISOString(),
        errorKind: retryKind,
      });
      return {
        action: "retry",
        outcome: "retryable",
        delaySeconds: retryDelay(input.queueAttempts, input.random ?? Math.random),
      };
    }

    await finishTask(input.db, {
      taskId: input.task.id,
      leaseToken,
      status: "completed",
      now: now.toISOString(),
    });
    await recordSourceSuccess(input.db, sourceHealthKey, now);
    return { action: "ack", outcome: "completed" };
  } catch (error) {
    const errorKind = error instanceof Error ? error.name : "UnknownError";
    if (input.queueAttempts >= input.maxAttempts) {
      await completeTerminal(input, leaseToken, now, "attempts_exhausted", errorKind, sourceHealthKey);
      return { action: "ack", outcome: "terminal", reason: "attempts_exhausted" };
    }
    await finishTask(input.db, {
      taskId: input.task.id,
      leaseToken,
      status: "retryable",
      now: now.toISOString(),
      errorKind,
    });
    await recordOperationalEvent(input.db, {
      eventKey: `task:${input.task.id}:exception:${input.queueAttempts}`,
      eventType: "task_retryable_failure",
      roundId: input.task.roundId,
      taskId: input.task.id,
      queryId: input.task.queryId,
      adapterId: input.task.adapterId,
      payload: { errorKind },
    });
    return {
      action: "retry",
      outcome: "retryable",
      delaySeconds: retryDelay(input.queueAttempts, input.random ?? Math.random),
    };
  }
}

export function retryDelay(attempts: number, random: () => number): number {
  const exponential = Math.min(1_800, 300 * 2 ** Math.max(0, attempts - 1));
  return Math.min(1_800, exponential + Math.floor(random() * 30));
}

async function completeTerminal(
  input: ConsumerInput,
  leaseToken: string,
  now: Date,
  reason: string,
  errorKind?: string,
  sourceHealthKey = input.task.adapterId,
  recordHealth = true,
): Promise<void> {
  await finishTask(input.db, {
    taskId: input.task.id,
    leaseToken,
    status: "terminal",
    now: now.toISOString(),
    terminalReason: reason,
    errorKind,
  });
  await recordOperationalEvent(input.db, {
    eventKey: `task:${input.task.id}:terminal:${reason}`,
    eventType: "task_terminal",
    roundId: input.task.roundId,
    taskId: input.task.id,
    queryId: input.task.queryId,
    adapterId: input.task.adapterId,
    payload: { reason, errorKind: errorKind ?? null },
  });
  if (!recordHealth) return;
  const health = await recordSourceTerminalFailure(input.db, sourceHealthKey, errorKind ?? reason, now);
  if (health.pausedUntil) {
    await recordOperationalEvent(input.db, {
      eventKey: `source:${input.task.adapterId}:paused:${health.pausedUntil}`,
      eventType: "source_paused",
      adapterId: input.task.adapterId,
      payload: { reason: errorKind ?? reason },
    });
  }
}
