import { describe, expect, it } from "vitest";
import { decideBudget, type UsageSnapshot } from "../../src/budget/budget-guard";
import { freeFirstConfig, validateFreeFirstConfig } from "../../src/config";

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

  it("reduces experimental work in conservative mode", () => {
    expect(decideBudget({ ...emptyUsage, queueOperations: 5_600 }).admitOptional).toBe(false);
  });

  it("does not stop essential discovery when only AI is exhausted", () => {
    const decision = decideBudget({ ...emptyUsage, aiNeurons: 8_000 });
    expect(decision.state).toBe("NORMAL");
    expect(decision.admitEssential).toBe(true);
    expect(decision.admitEnrichment).toBe(false);
  });

  it("degrades invalid usage conservatively", () => {
    const decision = decideBudget({ ...emptyUsage, queueOperations: Number.NaN });
    expect(decision.state).toBe("CONSERVATIVE");
    expect(decision.admitOptional).toBe(false);
  });

  it("rejects overlapping thresholds", () => {
    expect(() => validateFreeFirstConfig({ ...freeFirstConfig, essentialRatio: 0.6 })).toThrow(/ordered/);
  });
});
