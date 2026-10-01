import { describe, expect, it } from "vitest";
import { LinkedInGuestAdapter } from "../../src/adapters/linkedin-guest";
import { linkedinGuestSources } from "../../src/portfolio/sources";
import type { QueryDefinition } from "../../src/domain/types";

const source = linkedinGuestSources[0];
const task = { id: "task", roundId: "round", queryId: "board", adapterId: source.id, idempotencyKey: "key", attempt: 0 };
const queries: QueryDefinition[] = [{ id: "junior", revision: "1", family: "ROLE", terms: ["java", "junior"], exclusions: [], priority: 1, estimatedCost: 1, active: true }];

function adapterWith(html: string, fetcher?: typeof fetch) {
  return new LinkedInGuestAdapter(source, queries, () => new Date("2026-10-01T07:00:00.000Z"), fetcher ?? (async () => new Response(html, { headers: { "content-type": "text/html" } })));
}

describe("LinkedIn guest adapter", () => {
  it("maps one matching guest card without credentials or browser headers", async () => {
    const adapter = adapterWith(`<li><div data-entity-urn="urn:li:jobPosting:123"></div>
      <h3 class="base-search-card__title">Desenvolvedor Java Junior</h3>
      <h4 class="base-search-card__subtitle"><a>Empresa</a></h4>
      <a class="base-card__full-link" href="https://br.linkedin.com/jobs/view/123?tracking=1"></a>
      <span class="job-search-card__location">Brasil</span></li>`);
    const result = await adapter.discover(task);
    expect(result.observations[0]).toMatchObject({
      sourceVacancyId: "123", canonicalUrl: "https://br.linkedin.com/jobs/view/123",
      title: "Desenvolvedor Java Junior", organization: "Empresa", originKind: "real",
    });
  });

  it("uses the single, transparent guest request contract", async () => {
    let requestedUrl = "";
    let headers: HeadersInit | undefined;
    const adapter = adapterWith("<li></li>", async (input, init) => {
      requestedUrl = String(input);
      headers = init?.headers;
      return new Response("<li></li>", { headers: { "content-type": "text/html" } });
    });
    await adapter.discover(task);
    expect(requestedUrl).toBe("https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Desenvolvedor+Java+Junior&f_TPR=r7200&geoId=106057199&start=0");
    expect(headers).toMatchObject({ "user-agent": "Haadar vacancy discovery", accept: "text/html" });
  });

  it("classifies a challenge page as blocked", async () => {
    const result = await adapterWith("<html><title>Security check</title></html>").discover(task);
    expect(result.diagnostics[0]).toMatchObject({ kind: "blocked", message: "challenge_page" });
  });

  it("reports changed markup and ignores non-LinkedIn job links", async () => {
    const changed = await adapterWith("<li><h3 class=\"different-title\">Java Junior</h3></li>").discover(task);
    expect(changed.diagnostics[0]).toMatchObject({ kind: "schema_changed", message: "linkedin_guest_cards_missing" });

    const ignored = await adapterWith(`<li><div data-entity-urn="urn:li:jobPosting:123"></div>
      <h3 class="base-search-card__title">Desenvolvedor Java Junior</h3>
      <a class="base-card__full-link" href="https://evil.example/jobs/123"></a></li>`).discover(task);
    expect(ignored).toMatchObject({ observations: [], diagnostics: [{ kind: "schema_changed", message: "linkedin_guest_cards_missing" }] });
  });
});
