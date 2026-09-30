import { describe, expect, it } from "vitest";
import { idempotencyKey, roundSlotFor } from "../../src/domain/ids";

describe("domain identifiers", () => {
  it("normalizes the same scheduled instant to one UTC slot", () => {
    expect(roundSlotFor(new Date("2026-09-30T01:30:00.000Z"))).toBe("2026-09-30T01:30Z");
  });

  it("returns the same key for the same ordered parts", async () => {
    const first = await idempotencyKey(["round", "2026-09-30T01:30Z", "query-1"]);
    const second = await idempotencyKey(["round", "2026-09-30T01:30Z", "query-1"]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});
