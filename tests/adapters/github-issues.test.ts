import { describe, expect, it } from "vitest";
import { GitHubIssuesAdapter } from "../../src/adapters/github-issues";
import { githubIssuesSources } from "../../src/portfolio/sources";
import type { QueryDefinition } from "../../src/domain/types";

const source = githubIssuesSources[0];
const task = { id: "task", roundId: "round", queryId: "board", adapterId: source.id, idempotencyKey: "key", attempt: 0 };
const queries: QueryDefinition[] = [
  { id: "role", revision: "1", family: "ROLE", terms: ["backend", "software engineer"], exclusions: [], priority: 2, estimatedCost: 1, active: true },
  { id: "stack", revision: "1", family: "STACK", terms: ["typescript"], exclusions: [], priority: 1, estimatedCost: 1, active: true },
];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("GitHub Issues adapter", () => {
  it("fetches one public issue listing, skips pull requests and attributes matching queries", async () => {
    let requestedUrl = "";
    let apiVersion = "";
    let userAgent = "";
    const adapter = new GitHubIssuesAdapter(source, queries, () => new Date("2026-10-01T12:00:00.000Z"), async (input, init) => {
      requestedUrl = String(input);
      apiVersion = new Headers(init?.headers).get("x-github-api-version") ?? "";
      userAgent = new Headers(init?.headers).get("user-agent") ?? "";
      return jsonResponse([
        {
          id: 42,
          title: "Junior Backend Engineer",
          body: "TypeScript and Node.js position. Remote Brazil.",
          html_url: "https://github.com/backend-br/vagas/issues/42#comment-1",
          created_at: "2026-10-01T10:00:00Z",
        },
        {
          id: 43,
          title: "Junior Backend Engineer",
          body: "Ignore this pull request.",
          html_url: "https://github.com/backend-br/vagas/pull/43",
          created_at: "2026-10-01T10:00:00Z",
          pull_request: {},
        },
      ]);
    });

    const result = await adapter.discover(task);

    expect(requestedUrl).toBe("https://api.github.com/repos/backend-br/vagas/issues?state=open&sort=created&direction=desc&per_page=50");
    expect(apiVersion).toBe("2022-11-28");
    expect(userAgent).toBe("Haadar vacancy discovery");
    expect(result.diagnostics).toEqual([]);
    expect(result.observations.map((item) => item.queryId)).toEqual(["role", "stack"]);
    expect(result.observations[0]).toMatchObject({
      sourceId: "github-issues:backend-br/vagas",
      sourceVacancyId: "42",
      canonicalUrl: "https://github.com/backend-br/vagas/issues/42",
      organization: "backend-br/vagas",
      title: "Junior Backend Engineer",
      publishedAt: "2026-10-01T10:00:00.000Z",
      workModel: "remote",
      originKind: "real",
    });
  });

  it("rejects malformed payloads and marks GitHub throttling as retryable", async () => {
    const malformed = new GitHubIssuesAdapter(source, queries, () => new Date(), async () => jsonResponse({ message: "wrong shape" }));
    const throttled = new GitHubIssuesAdapter(source, queries, () => new Date(), async () => new Response("", {
      status: 429,
      headers: { "content-type": "application/json" },
    }));

    expect((await malformed.discover(task)).diagnostics[0]).toMatchObject({ kind: "schema_changed" });
    expect((await throttled.discover(task)).diagnostics[0]).toMatchObject({ kind: "throttled" });
  });
});
