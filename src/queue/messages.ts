import type { DiscoveryTask } from "../domain/types";

export type DiscoveryTaskMessage = DiscoveryTask;

const MAX_MESSAGE_BYTES = 32 * 1024;

export type MessageValidation =
  | { ok: true; value: DiscoveryTaskMessage }
  | { ok: false; reason: "invalid_schema" | "message_too_large" };

export function parseMessage(body: unknown): MessageValidation {
  let encoded: string;
  try {
    encoded = JSON.stringify(body);
  } catch {
    return { ok: false, reason: "invalid_schema" };
  }
  if (new TextEncoder().encode(encoded).byteLength > MAX_MESSAGE_BYTES) {
    return { ok: false, reason: "message_too_large" };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "invalid_schema" };
  const value = body as Record<string, unknown>;
  const required = ["id", "roundId", "queryId", "adapterId", "idempotencyKey"];
  if (required.some((key) => typeof value[key] !== "string" || value[key]!.length === 0 || value[key]!.length > 256)) {
    return { ok: false, reason: "invalid_schema" };
  }
  if (!Number.isInteger(value.attempt) || (value.attempt as number) < 0) return { ok: false, reason: "invalid_schema" };
  return { ok: true, value: body as DiscoveryTaskMessage };
}

export function toMessage(task: DiscoveryTask): DiscoveryTaskMessage {
  return { ...task };
}
