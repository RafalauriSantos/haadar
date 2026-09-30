import { describe, expect, it } from "vitest";
import { GreenhouseAdapter } from "../../src/adapters/greenhouse";
import { fetchBoundedJson } from "../../src/adapters/http";
import { pilotSources } from "../../src/portfolio/sources";
import type { QueryDefinition } from "../../src/domain/types";

const source = pilotSources[0];
const task = { id: "task", roundId: "round", queryId: "board", adapterId: source.id, idempotencyKey: "key", attempt: 0 };
const queries: QueryDefinition[] = [
  { id: "role", revision: "1", family: "ROLE", terms: ["backend", "software engineer"], exclusions: [], priority: 2, estimatedCost: 1, active: true },
  { id: "stack", revision: "1", family: "STACK", terms: ["typescript"], exclusions: [], priority: 1, estimatedCost: 1, active: true },
];

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function adapterWith(body: unknown, responseInit: ResponseInit = {}) {
  return new GreenhouseAdapter(
    source,
    queries,
    () => new Date("2026-09-30T12:00:00.000Z"),
    async () => jsonResponse(body, responseInit),
  );
}

describe("Greenhouse adapter", () => {
  it("normalizes and attributes one board fetch to matching queries", async () => {
    const adapter = adapterWith({ jobs: [{
      id: 42,
      title: "Software Engineer - Backend",
      absolute_url: "https://job-boards.greenhouse.io/example/jobs/42#apply",
      updated_at: "2026-09-29T10:00:00Z",
      location: { name: "Remote - Brazil" },
      content: "<p>Build services with TypeScript.</p>",
    }], meta: { total: 1 } });
    const result = await adapter.discover(task);
    expect(result.diagnostics).toEqual([]);
    expect(result.observations.map((item) => item.queryId)).toEqual(["role", "stack"]);
    expect(result.observations[0]).toMatchObject({
      sourceVacancyId: "42",
      canonicalUrl: "https://job-boards.greenhouse.io/example/jobs/42",
      workModel: "remote",
      originKind: "real",
      observedAt: "2026-09-30T12:00:00.000Z",
    });
    expect(result.observations[0].publishedAt).toBeUndefined();
    expect(result.observations[0].descriptionSummary).toBe("Build services with TypeScript.");
  });

  it("accepts an empty board and rejects changed schemas", async () => {
    expect((await adapterWith({ jobs: [], meta: { total: 0 } }).discover(task)).observations).toEqual([]);
    expect((await adapterWith({ positions: [] }).discover(task)).diagnostics[0].kind).toBe("schema_changed");
    expect((await adapterWith({ jobs: [{ title: "missing id" }] }).discover(task)).diagnostics[0].kind).toBe("schema_changed");
  });

  it("classifies rate limits, server failures and unexpected HTML", async () => {
    const throttled = new GreenhouseAdapter(source, queries, () => new Date(), async () => new Response("", { status: 429, headers: { "retry-after": "60", "content-type": "application/json" } }));
    const server = new GreenhouseAdapter(source, queries, () => new Date(), async () => new Response("", { status: 503, headers: { "content-type": "application/json" } }));
    const html = new GreenhouseAdapter(source, queries, () => new Date(), async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await throttled.discover(task)).diagnostics[0].kind).toBe("throttled");
    expect((await server.discover(task)).diagnostics[0].kind).toBe("retryable");
    expect((await html.discover(task)).diagnostics[0].kind).toBe("schema_changed");
  });

  it("rejects oversized bodies and unapproved redirects", async () => {
    await expect(fetchBoundedJson("https://boards-api.greenhouse.io/test", {
      allowedHosts: source.allowedHosts,
      timeoutMs: 100,
      maxBytes: 5,
      fetcher: async () => jsonResponse({ too: "large" }),
    })).rejects.toMatchObject({ kind: "permanent", message: "response_too_large" });

    await expect(fetchBoundedJson("https://boards-api.greenhouse.io/test", {
      allowedHosts: source.allowedHosts,
      timeoutMs: 100,
      maxBytes: 100,
      maxRedirects: 1,
      fetcher: async () => new Response("", { status: 302, headers: { location: "https://evil.example/jobs" } }),
    })).rejects.toMatchObject({ kind: "blocked", message: "url_not_allowed" });
  });

  it("times out bounded requests", async () => {
    await expect(fetchBoundedJson("https://boards-api.greenhouse.io/test", {
      allowedHosts: source.allowedHosts,
      timeoutMs: 5,
      maxBytes: 100,
      fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    })).rejects.toMatchObject({ kind: "retryable", message: "request_timeout" });
  });
});
