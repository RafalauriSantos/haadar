import type { BudgetState } from "./domain/types";

export interface DailyCeilings {
  workersRequests: number;
  queueOperations: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  workflowSteps: number;
  aiNeurons: number;
}

export interface FreeFirstConfig {
  ceilings: DailyCeilings;
  reserveRatio: number;
  conservativeRatio: number;
  essentialRatio: number;
}

export const freeFirstConfig: FreeFirstConfig = {
  ceilings: {
    workersRequests: 80_000,
    queueOperations: 8_000,
    d1RowsRead: 4_000_000,
    d1RowsWritten: 80_000,
    workflowSteps: 2_400,
    aiNeurons: 8_000
  },
  reserveRatio: 0.2,
  conservativeRatio: 0.7,
  essentialRatio: 0.85
};

export function budgetState(usageRatio: number, config: FreeFirstConfig = freeFirstConfig): BudgetState {
  if (usageRatio >= 0.95) return "EMERGENCY";
  if (usageRatio >= config.essentialRatio) return "ESSENTIAL";
  if (usageRatio >= config.conservativeRatio) return "CONSERVATIVE";
  return "NORMAL";
}
