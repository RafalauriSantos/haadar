import { describe, expect, it } from "vitest";
import { FixtureAdapter } from "../../src/adapters/fixtures";

describe("adapter contract", () => {
  it("returns normalized observations and typed diagnostics", async () => {
    const result = await new FixtureAdapter().discover({ id: "task-1", roundId: "round-1", queryId: "query-1", adapterId: "fixture", idempotencyKey: "key", attempt: 0 });
    expect(result.sourceId).toBe("fixture");
    expect(result.observations).toHaveLength(2);
    expect(result.diagnostics[0].kind).toBe("retryable");
  });
});
