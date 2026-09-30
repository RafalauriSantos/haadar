import { describe, expect, it } from "vitest";
import { enrichWithAi } from "../../src/ai/enrichment";

describe("optional Workers AI enrichment", () => {
  it("falls back when AI is unavailable", async () => {
    const result = await enrichWithAi({ title: "Backend" }, undefined, { model: "model", promptVersion: "v1", allowedModels: ["model"], budgetAllowed: true });
    expect(result.status).toBe("fallback");
    expect(result.fallbackReason).toBe("unavailable");
  });

  it("rejects non-object model output", async () => {
    const result = await enrichWithAi({}, { run: async () => "invalid" }, { model: "model", promptVersion: "v1", allowedModels: ["model"], budgetAllowed: true });
    expect(result.fallbackReason).toBe("invalid_schema");
  });
});
