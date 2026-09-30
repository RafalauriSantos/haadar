import { describe, expect, it } from "vitest";
import { budgetState, freeFirstConfig } from "../../src/config";

describe("Free-First budget configuration", () => {
  it("uses the four documented operating states", () => {
    expect(budgetState(0.69)).toBe("NORMAL");
    expect(budgetState(0.7)).toBe("CONSERVATIVE");
    expect(budgetState(0.85)).toBe("ESSENTIAL");
    expect(budgetState(0.95)).toBe("EMERGENCY");
  });

  it("keeps a retry and control-plane reserve", () => {
    expect(freeFirstConfig.reserveRatio).toBe(0.2);
  });
});
