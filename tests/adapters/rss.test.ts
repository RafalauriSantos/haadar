import { describe, expect, it } from "vitest";
import { GoogleNewsRssAdapter } from "../../src/adapters/rss";
import { rssSources } from "../../src/portfolio/sources";

describe("Google News RSS adapter", () => {
  it("maps a matching public feed item and retains its public URL", async () => {
    const adapter = new GoogleNewsRssAdapter(rssSources[0], [{ id: "role", revision: "1", family: "ROLE", terms: ["java"], exclusions: [], priority: 1, estimatedCost: 1, active: true }], () => new Date("2026-10-01T12:00:00Z"), async () => new Response(`<?xml version="1.0"?><rss><channel><item><guid>rss-1</guid><title>Vaga Desenvolvedor Java Junior — Empresa</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Wed, 01 Oct 2026 10:00:00 GMT</pubDate><description>Vaga remota para Java.</description></item></channel></rss>`, { headers: { "content-type": "application/rss+xml" } }));
    const result = await adapter.discover({ id: "task", roundId: "round", queryId: "board", adapterId: rssSources[0].id, idempotencyKey: "key", attempt: 0 });
    expect(result.diagnostics).toEqual([]);
    expect(result.observations[0]).toMatchObject({ sourceVacancyId: "rss-1", title: "Vaga Desenvolvedor Java Junior — Empresa", canonicalUrl: "https://news.google.com/rss/articles/abc", publishedAt: "2026-10-01T10:00:00.000Z" });
  });

  it("identifies bounded public feed requests as Haadar", async () => {
    let headers: HeadersInit | undefined;
    const adapter = new GoogleNewsRssAdapter(
      rssSources[0],
      [],
      () => new Date(),
      async (_input, init) => {
        headers = init?.headers;
        return new Response("<rss><channel></channel></rss>", { headers: { "content-type": "application/rss+xml" } });
      },
    );
    await adapter.discover({ id: "task", roundId: "round", queryId: "board", adapterId: rssSources[0].id, idempotencyKey: "key", attempt: 0 });
    expect(headers).toMatchObject({ "user-agent": "Haadar vacancy discovery" });
  });
});
