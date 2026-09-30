import { describe, expect, it } from "vitest";
import { idempotencyKey, roundSlotFor } from "../../src/domain/ids";

describe("domain identifiers", () => {
  it("normalizes the same scheduled instant to one UTC slot", () => {
    expect(roundSlotFor(new Date("2026-09-30T01:59:59.999Z"))).toBe("2026-09-30T01:30:00.000Z");
    expect(roundSlotFor(new Date("2026-09-29T22:59:59.999-03:00"))).toBe("2026-09-30T01:30:00.000Z");
  });

  it("anchors slots at UTC midnight across day boundaries", () => {
    expect(roundSlotFor(new Date("2026-09-30T00:00:00.000Z"))).toBe("2026-09-30T00:00:00.000Z");
    expect(roundSlotFor(new Date("2026-09-30T23:59:59.999Z"))).toBe("2026-09-30T22:30:00.000Z");
  });

  it("rejects invalid dates", () => {
    expect(() => roundSlotFor(new Date("invalid"))).toThrow(/valid date/);
  });

  it("returns the same key for the same ordered parts", async () => {
    const first = await idempotencyKey(["round", "2026-09-30T01:30Z", "query-1"]);
    const second = await idempotencyKey(["round", "2026-09-30T01:30Z", "query-1"]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not collide when a previous separator appears inside parts", async () => {
    const first = await idempotencyKey(["a\u001fb", "c"]);
    const second = await idempotencyKey(["a", "b\u001fc"]);
    expect(first).not.toBe(second);
  });
});
