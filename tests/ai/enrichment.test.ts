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

  it("accepts only bounded structured enrichment output", async () => {
    const valid = await enrichWithAi({}, {
      run: async () => ({ summary: "Backend role", skills: ["TypeScript"], confidence: 0.8 }),
    }, { model: "model", promptVersion: "v1", allowedModels: ["model"], budgetAllowed: true });
    expect(valid.status).toBe("completed");

    const invalid = await enrichWithAi({}, {
      run: async () => ({ summary: "Backend role", skills: ["TypeScript"], confidence: 2 }),
    }, { model: "model", promptVersion: "v1", allowedModels: ["model"], budgetAllowed: true });
    expect(invalid.fallbackReason).toBe("invalid_schema");
  });

  it.each(["429 from provider", "AI request timed out"])("keeps the deterministic path available after %s", async (message) => {
    const result = await enrichWithAi({}, {
      run: async () => { throw new Error(message); },
    }, { model: "model", promptVersion: "v1", allowedModels: ["model"], budgetAllowed: true });

    expect(result).toMatchObject({ status: "fallback", fallbackReason: "invalid_schema", output: null });
  });
});
