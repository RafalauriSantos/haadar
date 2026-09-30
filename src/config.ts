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
  emergencyRatio: number;
  maxTasksPerRound: number;
  maxTasksPerSource: number;
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
  essentialRatio: 0.85,
  emergencyRatio: 0.95,
  maxTasksPerRound: 25,
  maxTasksPerSource: 10,
};

export function budgetState(usageRatio: number, config: FreeFirstConfig = freeFirstConfig): BudgetState {
  validateFreeFirstConfig(config);
  if (!Number.isFinite(usageRatio) || usageRatio < 0) return "CONSERVATIVE";
  if (usageRatio >= config.emergencyRatio) return "EMERGENCY";
  if (usageRatio >= config.essentialRatio) return "ESSENTIAL";
  if (usageRatio >= config.conservativeRatio) return "CONSERVATIVE";
  return "NORMAL";
}

export function validateFreeFirstConfig(config: FreeFirstConfig): void {
  const { conservativeRatio, essentialRatio, emergencyRatio, reserveRatio } = config;
  if (!(0 <= conservativeRatio && conservativeRatio < essentialRatio && essentialRatio < emergencyRatio && emergencyRatio <= 1)) {
    throw new RangeError("budget thresholds must be ordered and non-overlapping");
  }
  if (!(reserveRatio >= 0 && reserveRatio < 1)) throw new RangeError("reserve ratio must be between zero and one");
  if (Object.values(config.ceilings).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("budget ceilings must be positive finite values");
  }
}
