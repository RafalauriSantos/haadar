import type { DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import type { TramposSourceDefinition } from "../portfolio/sources";
import type { AdapterResult, SourceAdapter } from "./adapter";
import { AdapterHttpError, fetchBoundedJson } from "./http";
import { explicitWorkModel, normalizeWhitespace, vacancyFingerprint } from "../normalization/vacancy";

export class TramposAdapter implements SourceAdapter {
  readonly id: string; readonly fetchStrategy = "board_once" as const;
  constructor(private readonly source: TramposSourceDefinition, private readonly queries: QueryDefinition[], private readonly observedAt: () => Date = () => new Date(), private readonly fetcher: typeof fetch = fetch) { this.id = source.id; }
  async discover(_task: DiscoveryTask): Promise<AdapterResult> {
    try {
      const raw = await fetchBoundedJson("https://trampos.co/api/v2/opportunities?page=1", { ...this.source.limits, maxBytes: this.source.limits.maxResponseBytes, allowedHosts: this.source.allowedHosts, headers: { "user-agent": "Haadar vacancy discovery" }, fetcher: this.fetcher });
      const opportunities = (raw as { opportunities?: unknown }).opportunities;
      if (!Array.isArray(opportunities) || opportunities.length > this.source.limits.maxRecords) throw new AdapterHttpError("schema_changed", "opportunities_array_missing");
      const observations: NormalizedObservation[] = [];
      for (const value of opportunities) {
        const job = value as Record<string, unknown>; if (!job || typeof job !== "object" || !Number.isInteger(job.id) || typeof job.name !== "string") throw new AdapterHttpError("schema_changed", "opportunity_fields_invalid");
        const title = normalizeWhitespace(job.name); const description = typeof job.description === "string" ? normalizeWhitespace(job.description).slice(0, 4_000) : ""; const location = normalizeWhitespace([job.city, job.state].filter((v): v is string => typeof v === "string").join(", "));
        const text = `${title} ${description} ${location}`.toLowerCase(); const fingerprint = await vacancyFingerprint({ organization: typeof job.company_name === "string" ? job.company_name : "Trampos.co", title, location, description });
        for (const query of this.queries.filter((q) => this.source.applicableQueryFamilies.includes(q.family) && !q.exclusions.some((term) => text.includes(term.toLowerCase())) && q.terms.some((term) => text.includes(term.toLowerCase())))) observations.push({ sourceId: this.id, sourceVacancyId: String(job.id), canonicalUrl: `https://trampos.co/oportunidades/${job.id}`, title, organization: typeof job.company_name === "string" ? job.company_name : "Trampos.co", location: location || undefined, workModel: explicitWorkModel(typeof job.workplace_type === "string" ? job.workplace_type : "", location, description), descriptionSummary: description || undefined, publishedAt: typeof job.published_at === "string" && Number.isFinite(Date.parse(job.published_at)) ? new Date(job.published_at).toISOString() : undefined, observedAt: this.observedAt().toISOString(), queryId: query.id, fingerprint, fingerprintVersion: "v1", originKind: "real" });
      }
      return { sourceId: this.id, observations, diagnostics: [] };
    } catch (error) { return { sourceId: this.id, observations: [], diagnostics: [{ kind: error instanceof AdapterHttpError ? error.kind : "schema_changed", message: error instanceof AdapterHttpError ? error.message : "trampos_payload_invalid", httpStatus: error instanceof AdapterHttpError ? error.httpStatus : undefined }] }; }
  }
}
