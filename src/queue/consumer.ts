import { persistCanonicalObservation, recordOperationalEvent } from "../storage/d1";
import { claimTaskForExecution, finishTask } from "../storage/tasks";
import type { SourceAdapter } from "../adapters/adapter";
import type { DiscoveryTask } from "../domain/types";
import { recordUsage } from "../observability/usage-ledger";
import { utcDay } from "../budget/reservations";

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

  try {
    const adapterResult = await adapter.discover(input.task);
    for (const observation of adapterResult.observations) {
      await persistCanonicalObservation(input.db, {
        ...observation,
        roundId: input.task.roundId,
        taskId: input.task.id,
        originKind: observation.originKind ?? "synthetic",
      });
    }
    for (const diagnostic of adapterResult.diagnostics) {
      await recordOperationalEvent(input.db, {
        eventKey: `task:${input.task.id}:diagnostic:${diagnostic.kind}:${input.queueAttempts}`,
        eventType: "adapter_diagnostic",
        roundId: input.task.roundId,
        taskId: input.task.id,
        queryId: input.task.queryId,
        adapterId: input.task.adapterId,
        payload: { kind: diagnostic.kind },
      });
    }

    const terminalKind = adapterResult.diagnostics.find((item) =>
      item.kind === "permanent" || item.kind === "blocked" || item.kind === "schema_changed"
    )?.kind;
    if (terminalKind) {
      await completeTerminal(input, leaseToken, now, terminalKind);
      return { action: "ack", outcome: "terminal", reason: terminalKind };
    }

    const retryKind = adapterResult.diagnostics.find((item) =>
      item.kind === "retryable" || item.kind === "throttled"
    )?.kind;
    if (retryKind) {
      if (input.queueAttempts >= input.maxAttempts) {
        await completeTerminal(input, leaseToken, now, "attempts_exhausted", retryKind);
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
    return { action: "ack", outcome: "completed" };
  } catch (error) {
    const errorKind = error instanceof Error ? error.name : "UnknownError";
    if (input.queueAttempts >= input.maxAttempts) {
      await completeTerminal(input, leaseToken, now, "attempts_exhausted", errorKind);
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
  const exponential = Math.min(600, 30 * 2 ** Math.max(0, attempts - 1));
  return Math.min(900, exponential + Math.floor(random() * 30));
}

async function completeTerminal(
  input: ConsumerInput,
  leaseToken: string,
  now: Date,
  reason: string,
  errorKind?: string,
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
}
