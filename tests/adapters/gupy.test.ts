import { describe, expect, it } from "vitest";
import { GupyAdapter } from "../../src/adapters/gupy";
import { gupySources } from "../../src/portfolio/sources";

describe("Gupy adapter", () => {
  it("maps public MCP SSE results to normalized observations", async () => {
    const adapter = new GupyAdapter(gupySources[0], [{ id: "role", revision: "1", family: "ROLE", terms: ["java"], exclusions: [], priority: 1, estimatedCost: 1, active: true }], () => new Date("2026-10-01T12:00:00Z"), async () => new Response(`data: ${JSON.stringify({ result: { content: [{ text: JSON.stringify({ data: { data: [{ id: 1, name: "Java Junior", careerPageName: "acme", city: "São Paulo", state: "SP", description: "Remote Java" }] } }) }] } })}\n`, { headers: { "content-type": "text/event-stream" } }));
    const result = await adapter.discover({ id: "task", roundId: "round", queryId: "board", adapterId: gupySources[0].id, idempotencyKey: "key", attempt: 0 });
    expect(result.diagnostics).toEqual([]);
    expect(result.observations[0]).toMatchObject({ sourceVacancyId: "1", canonicalUrl: "https://acme.gupy.io/jobs/1", workModel: "remote" });
  });
});
