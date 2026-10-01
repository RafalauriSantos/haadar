import type { DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import type { RssSourceDefinition } from "../portfolio/sources";
import type { AdapterResult, SourceAdapter } from "./adapter";
import { AdapterHttpError, fetchBoundedText } from "./http";
import { explicitWorkModel, htmlToBoundedText, normalizeWhitespace, vacancyFingerprint } from "../normalization/vacancy";

export class GoogleNewsRssAdapter implements SourceAdapter {
  readonly id: string; readonly fetchStrategy = "board_once" as const;
  constructor(private readonly source: RssSourceDefinition, private readonly queries: QueryDefinition[], private readonly observedAt: () => Date = () => new Date(), private readonly fetcher: typeof fetch = fetch) { this.id = source.id; }
  async discover(_task: DiscoveryTask): Promise<AdapterResult> { try { const text = await feedText(this.source, this.fetcher); const observations: NormalizedObservation[] = []; for (const item of parseItems(text, this.source.limits.maxRecords)) { const title = normalizeWhitespace(item.title); const description = htmlToBoundedText(item.description ?? ""); const haystack = `${title} ${description}`.toLowerCase(); const fingerprint = await vacancyFingerprint({ organization: this.source.organization, title, description }); for (const q of this.queries.filter(q => this.source.applicableQueryFamilies.includes(q.family) && !q.exclusions.some(t => haystack.includes(t.toLowerCase())) && q.terms.some(t => haystack.includes(t.toLowerCase())))) observations.push({ sourceId: this.id, sourceVacancyId: item.guid, canonicalUrl: item.link, title, organization: this.source.organization, workModel: explicitWorkModel(title, description), descriptionSummary: description || undefined, publishedAt: item.publishedAt, observedAt: this.observedAt().toISOString(), queryId: q.id, fingerprint, fingerprintVersion: "v1", originKind: "real" }); } return { sourceId: this.id, observations, diagnostics: [] }; } catch (error) { return { sourceId: this.id, observations: [], diagnostics: [{ kind: error instanceof AdapterHttpError ? error.kind : "schema_changed", message: error instanceof AdapterHttpError ? error.message : "rss_payload_invalid", httpStatus: error instanceof AdapterHttpError ? error.httpStatus : undefined }] }; } }
}
async function feedText(source: RssSourceDefinition, fetcher: typeof fetch): Promise<string> {
  return fetchBoundedText(source.feedUrl, {
    allowedHosts: source.allowedHosts,
    timeoutMs: source.limits.timeoutMs,
    maxBytes: source.limits.maxResponseBytes,
    headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "Haadar vacancy discovery" },
    expectedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
    fetcher,
  });
}
function parseItems(xml: string, max: number): Array<{ guid: string; title: string; link: string; description?: string; publishedAt?: string }> { const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]; if (items.length > max) throw new AdapterHttpError("permanent", "record_limit_exceeded"); return items.map(m => { const part = m[1]; const get = (tag: string) => normalizeWhitespace((part.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, "")); const guid = get("guid"), title = get("title"), link = get("link"), date = get("pubDate"); if (!guid || !title || !link || !isPublicUrl(link)) throw new AdapterHttpError("schema_changed", "rss_item_invalid"); return { guid, title, link, description: get("description") || undefined, publishedAt: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : undefined }; }); }
function isPublicUrl(value: string): boolean { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } }
