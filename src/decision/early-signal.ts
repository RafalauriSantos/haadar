import { idempotencyKey } from "../domain/ids";
import type { NormalizedObservation } from "../domain/types";
import type { GateResult } from "./deterministic-gate";

export interface EarlySignal {
  status: "provisional";
  idempotencyKey: string;
  reasonCode: "new_eligible_observation";
  ruleVersion: string;
}

export async function earlySignal(observation: NormalizedObservation, gate: GateResult): Promise<EarlySignal | null> {
  if (!gate.eligible) return null;
  return {
    status: "provisional",
    idempotencyKey: await idempotencyKey(["early-signal", observation.sourceId, observation.canonicalUrl]),
    reasonCode: "new_eligible_observation",
    ruleVersion: "early-signal-v1"
  };
}
