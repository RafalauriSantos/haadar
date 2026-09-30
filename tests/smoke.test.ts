import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("health endpoint", () => {
  it("returns a non-secret readiness response", async () => {
    const response = await worker.fetch(new Request("https://haadar.local/health"), {}, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "haadar", status: "ok" });
  });
});
