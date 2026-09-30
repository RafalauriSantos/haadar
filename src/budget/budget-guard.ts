import type { BudgetState } from "../domain/types";
import { budgetState, freeFirstConfig, type FreeFirstConfig } from "../config";

export interface UsageSnapshot {
  workersRequests: number;
  queueOperations: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  workflowSteps: number;
  aiNeurons: number;
}

export interface BudgetDecision {
  state: BudgetState;
  admitEssential: boolean;
  admitOptional: boolean;
  admitEnrichment: boolean;
  aiAvailable: boolean;
}

export function decideBudget(usage: UsageSnapshot, config: FreeFirstConfig = freeFirstConfig): BudgetDecision {
  const essentialRatios = [
    usage.workersRequests / config.ceilings.workersRequests,
    usage.queueOperations / config.ceilings.queueOperations,
    usage.d1RowsRead / config.ceilings.d1RowsRead,
    usage.d1RowsWritten / config.ceilings.d1RowsWritten,
    usage.workflowSteps / config.ceilings.workflowSteps,
  ];
  const invalid = Object.values(usage).some((value) => !Number.isFinite(value) || value < 0);
  const state = invalid ? "CONSERVATIVE" : budgetState(Math.max(...essentialRatios), config);
  const aiAvailable = Number.isFinite(usage.aiNeurons)
    && usage.aiNeurons >= 0
    && usage.aiNeurons / config.ceilings.aiNeurons < config.essentialRatio;
  return {
    state,
    admitEssential: state !== "EMERGENCY",
    admitOptional: state === "NORMAL",
    admitEnrichment: (state === "NORMAL" || state === "CONSERVATIVE") && aiAvailable,
    aiAvailable,
  };
}
