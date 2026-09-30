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
}

export function decideBudget(usage: UsageSnapshot, config: FreeFirstConfig = freeFirstConfig): BudgetDecision {
  const ratios = [
    usage.workersRequests / config.ceilings.workersRequests,
    usage.queueOperations / config.ceilings.queueOperations,
    usage.d1RowsRead / config.ceilings.d1RowsRead,
    usage.d1RowsWritten / config.ceilings.d1RowsWritten,
    usage.workflowSteps / config.ceilings.workflowSteps,
    usage.aiNeurons / config.ceilings.aiNeurons
  ];
  const state = budgetState(Math.max(...ratios), config);
  return {
    state,
    admitEssential: state !== "EMERGENCY",
    admitOptional: state === "NORMAL" || state === "CONSERVATIVE"
  };
}
