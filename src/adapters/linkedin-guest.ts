import type { DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import type { LinkedInGuestSourceDefinition } from "../portfolio/sources";
import type { AdapterResult, SourceAdapter } from "./adapter";
import { AdapterHttpError, fetchBoundedText } from "./http";
import { explicitWorkModel, htmlToBoundedText, normalizeWhitespace, vacancyFingerprint } from "../normalization/vacancy";

interface GuestCard {
  id: string;
  title: string;
  organization?: string;
  location?: string;
  url: string;
}

export class LinkedInGuestAdapter implements SourceAdapter {
  readonly id: string;
  readonly fetchStrategy = "board_once" as const;

  constructor(
    private readonly source: LinkedInGuestSourceDefinition,
    private readonly queries: QueryDefinition[],
    private readonly observedAt: () => Date = () => new Date(),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.id = source.id;
  }

  async discover(_task: DiscoveryTask): Promise<AdapterResult> {
    try {
      const html = await fetchBoundedText(guestSearchUrl(this.source), {
        ...this.source.limits,
        maxBytes: this.source.limits.maxResponseBytes,
        allowedHosts: this.source.allowedHosts,
        headers: {
          accept: "text/html",
          "user-agent": "Haadar vacancy discovery",
          "accept-language": "pt-BR,pt;q=0.9",
        },
        fetcher: this.fetcher,
      });
      if (isChallengePage(html)) throw new AdapterHttpError("blocked", "challenge_page");
      const cards = parseCards(html, this.source.limits.maxRecords);
      if (cards.length === 0) throw new AdapterHttpError("schema_changed", "linkedin_guest_cards_missing");
      const observations: NormalizedObservation[] = [];
      const observedAt = this.observedAt().toISOString();
      for (const card of cards) {
        const description = "";
        const matchingQueries = this.queries.filter((query) => this.source.applicableQueryFamilies.includes(query.family) && matches(query, {
          title: card.title,
          organization: card.organization ?? "",
          location: card.location ?? "",
          description,
        }));
        const fingerprint = await vacancyFingerprint({ organization: card.organization, title: card.title, location: card.location, description });
        for (const query of matchingQueries) {
          observations.push({
            sourceId: this.source.id,
            sourceVacancyId: card.id,
            canonicalUrl: card.url,
            title: card.title,
            organization: card.organization,
            location: card.location,
            workModel: explicitWorkModel(card.location ?? "", description),
            observedAt,
            queryId: query.id,
            fingerprint,
            fingerprintVersion: "v1",
            originKind: "real",
          });
        }
      }
      return { sourceId: this.source.id, observations, diagnostics: [] };
    } catch (error) {
      if (error instanceof AdapterHttpError) {
        return { sourceId: this.source.id, observations: [], diagnostics: [{ kind: error.kind, message: error.message }] };
      }
      return { sourceId: this.source.id, observations: [], diagnostics: [{ kind: "schema_changed", message: "linkedin_guest_payload_invalid" }] };
    }
  }
}

function guestSearchUrl(source: LinkedInGuestSourceDefinition): string {
  const params = new URLSearchParams({ keywords: source.keywords, f_TPR: source.timeRange, geoId: source.geoId, start: "0" });
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params}`;
}

function parseCards(html: string, maxRecords: number): GuestCard[] {
  const cards: GuestCard[] = [];
  for (const match of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (cards.length >= maxRecords) break;
    const card = match[1];
    const id = card.match(/data-entity-urn=["']urn:li:jobPosting:(\d+)["']/i)?.[1];
    const title = classText(card, "h3", "base-search-card__title");
    const url = classHref(card, "base-card__full-link");
    if (!id || !title || !url) continue;
    const canonicalUrl = validateGuestUrl(url);
    if (!canonicalUrl) continue;
    cards.push({
      id,
      title,
      url: canonicalUrl,
      organization: classText(card, "h4", "base-search-card__subtitle"),
      location: classText(card, "span", "job-search-card__location"),
    });
  }
  return cards;
}

function classText(html: string, tag: string, className: string): string | undefined {
  const value = html.match(new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1];
  const text = value ? normalizeWhitespace(htmlToBoundedText(value)) : "";
  return text || undefined;
}

function classHref(html: string, className: string): string | undefined {
  return html.match(new RegExp(`<a\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*href=["']([^"']+)["']`, "i"))?.[1];
}

function validateGuestUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !["linkedin.com", "br.linkedin.com"].includes(url.hostname)) return undefined;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function isChallengePage(html: string): boolean {
  return /captcha|security check|unusual activity|verify you are human/i.test(html);
}

function matches(query: QueryDefinition, vacancy: { title: string; organization: string; location: string; description: string }): boolean {
  const haystack = `${vacancy.title} ${vacancy.organization} ${vacancy.location} ${vacancy.description}`.toLowerCase();
  return !query.exclusions.some((term) => haystack.includes(term.toLowerCase())) && query.terms.some((term) => haystack.includes(term.toLowerCase()));
}
