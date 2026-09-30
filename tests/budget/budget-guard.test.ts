import { describe, expect, it } from "vitest";
import { decideBudget, type UsageSnapshot } from "../../src/budget/budget-guard";

const emptyUsage: UsageSnapshot = {
  workersRequests: 0,
  queueOperations: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  workflowSteps: 0,
  aiNeurons: 0
};

describe("Budget Guard", () => {
  it("transitions based on the highest service ratio", () => {
    expect(decideBudget(emptyUsage).state).toBe("NORMAL");
    expect(decideBudget({ ...emptyUsage, queueOperations: 5_600 }).state).toBe("CONSERVATIVE");
    expect(decideBudget({ ...emptyUsage, queueOperations: 6_800 }).state).toBe("ESSENTIAL");
    expect(decideBudget({ ...emptyUsage, queueOperations: 7_600 }).state).toBe("EMERGENCY");
  });

  it("does not admit optional work in essential mode", () => {
    const decision = decideBudget({ ...emptyUsage, queueOperations: 6_800 });
    expect(decision.admitEssential).toBe(true);
    expect(decision.admitOptional).toBe(false);
  });
});
