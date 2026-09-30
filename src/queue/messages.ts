import type { DiscoveryTask } from "../domain/types";

export type DiscoveryTaskMessage = DiscoveryTask;

export function toMessage(task: DiscoveryTask): DiscoveryTaskMessage {
  return { ...task };
}
