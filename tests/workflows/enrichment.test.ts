import { describe, expect, it } from "vitest";
import { runSelectiveEnrichment } from "../../src/workflows/enrichment";

describe("selective enrichment", () => {
  it("does not start optional work in essential or emergency states", async () => {
    const result = await runSelectiveEnrichment({ candidate: {}, budgetState: "ESSENTIAL", aiBinding: { run: async () => ({}) } });
    expect(result.fallbackReason).toBe("budget_blocked");
  });
});
