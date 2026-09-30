import type { HeuristicScore } from "./heuristic-score";
import type { EarlySignal } from "./early-signal";

export interface FinalDecision {
  outcome: "alert" | "discard";
  reasonCode: "heuristic_threshold" | "below_threshold";
  ruleVersion: string;
  earlySignalKey?: string;
}

export function finalDecision(score: HeuristicScore, signal: EarlySignal | null, threshold = 0.5): FinalDecision {
  const alert = score.value >= threshold;
  return {
    outcome: alert ? "alert" : "discard",
    reasonCode: alert ? "heuristic_threshold" : "below_threshold",
    ruleVersion: "decision-v1",
    ...(signal ? { earlySignalKey: signal.idempotencyKey } : {})
  };
}
