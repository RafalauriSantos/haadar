import { insertObservationFirst, recordOperationalEvent, type D1DatabaseLike } from "../storage/d1";
import type { SourceAdapter } from "../adapters/adapter";
import type { DiscoveryTask } from "../domain/types";
import type { DiscoveryTaskMessage } from "./messages";

export interface ConsumerResult {
  completed: string[];
  retryable: string[];
  terminal: string[];
}

export interface ConsumerInput {
  db: D1DatabaseLike;
  batch: DiscoveryTaskMessage[];
  adapters: Record<string, SourceAdapter>;
  maxAttempts: number;
}

export async function consume(input: ConsumerInput): Promise<ConsumerResult> {
  const result: ConsumerResult = { completed: [], retryable: [], terminal: [] };
  const seen = new Set<string>();
  for (const message of input.batch) {
    if (seen.has(message.idempotencyKey)) continue;
    seen.add(message.idempotencyKey);

    const adapter = input.adapters[message.adapterId];
    if (!adapter) {
      result.terminal.push(message.idempotencyKey);
      await recordOperationalEvent(input.db, {
        eventKey: `task:${message.idempotencyKey}:missing-adapter`,
        eventType: "task_terminal",
        roundId: message.roundId,
        taskId: message.id,
        queryId: message.queryId,
        adapterId: message.adapterId,
        payload: { reason: "missing_adapter" }
      });
      continue;
    }

    try {
      const adapterResult = await adapter.discover(message as DiscoveryTask);
      for (const observation of adapterResult.observations) {
        await insertObservationFirst(input.db, observation);
      }
      for (const diagnostic of adapterResult.diagnostics) {
        await recordOperationalEvent(input.db, {
          eventKey: `task:${message.idempotencyKey}:diagnostic:${diagnostic.kind}`,
          eventType: "adapter_diagnostic",
          roundId: message.roundId,
          taskId: message.id,
          queryId: message.queryId,
          adapterId: message.adapterId,
          payload: { ...diagnostic }
        });
      }
      const retryable = adapterResult.diagnostics.some((diagnostic) => diagnostic.kind === "retryable" || diagnostic.kind === "throttled");
      if (retryable && message.attempt + 1 < input.maxAttempts) {
        result.retryable.push(message.idempotencyKey);
      } else if (retryable) {
        result.terminal.push(message.idempotencyKey);
      } else {
        result.completed.push(message.idempotencyKey);
      }
    } catch (error) {
      const retryable = message.attempt + 1 < input.maxAttempts;
      (retryable ? result.retryable : result.terminal).push(message.idempotencyKey);
      await recordOperationalEvent(input.db, {
        eventKey: `task:${message.idempotencyKey}:exception:${message.attempt}`,
        eventType: retryable ? "task_retryable_failure" : "task_terminal",
        roundId: message.roundId,
        taskId: message.id,
        queryId: message.queryId,
        adapterId: message.adapterId,
        payload: { error: error instanceof Error ? error.message : "unknown_error" }
      });
    }
  }
  return result;
}
