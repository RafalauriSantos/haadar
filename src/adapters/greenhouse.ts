import type { DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import type { SourceDefinition } from "../portfolio/sources";
import type { AdapterResult, SourceAdapter } from "./adapter";
import { AdapterHttpError, fetchBoundedJson } from "./http";
import { explicitWorkModel, htmlToBoundedText, normalizeWhitespace, vacancyFingerprint } from "../normalization/vacancy";

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  content?: string;
  location?: { name?: string };
}

export class GreenhouseAdapter implements SourceAdapter {
  readonly id: string;
  readonly fetchStrategy = "board_once" as const;

  constructor(
    private readonly source: SourceDefinition,
    private readonly queries: QueryDefinition[],
    private readonly observedAt: () => Date = () => new Date(),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.id = source.id;
  }

  async discover(task: DiscoveryTask): Promise<AdapterResult> {
    try {
      const payload = await fetchBoundedJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(this.source.boardToken)}/jobs?content=true`,
        { ...this.source.limits, maxBytes: this.source.limits.maxResponseBytes, allowedHosts: this.source.allowedHosts, fetcher: this.fetcher },
      );
      const jobs = parseJobs(payload, this.source.limits.maxRecords);
      const observations: NormalizedObservation[] = [];
      const observedAt = this.observedAt().toISOString();
      for (const job of jobs) {
        const title = normalizeWhitespace(job.title);
        const location = normalizeWhitespace(job.location?.name ?? "");
        const description = htmlToBoundedText(job.content ?? "");
        const url = validatePublicJobUrl(job.absolute_url);
        const matchingQueries = this.queries.filter((query) => this.source.applicableQueryFamilies.includes(query.family) && matches(query, {
          title,
          location,
          description,
          organization: this.source.organization,
        }));
        const fingerprint = await vacancyFingerprint({ organization: this.source.organization, title, location, description });
        for (const query of matchingQueries) {
          observations.push({
            sourceId: this.source.id,
            sourceVacancyId: String(job.id),
            canonicalUrl: url,
            title,
            organization: this.source.organization,
            location: location || undefined,
            workModel: explicitWorkModel(location, description),
            descriptionSummary: description || undefined,
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
      return { sourceId: this.source.id, observations: [], diagnostics: [{ kind: "schema_changed", message: "greenhouse_payload_invalid" }] };
    }
  }
}

function parseJobs(payload: unknown, maxRecords: number): GreenhouseJob[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { jobs?: unknown }).jobs)) {
    throw new AdapterHttpError("schema_changed", "jobs_array_missing");
  }
  const jobs = (payload as { jobs: unknown[] }).jobs;
  if (jobs.length > maxRecords) throw new AdapterHttpError("permanent", "record_limit_exceeded");
  return jobs.map((value) => {
    if (!value || typeof value !== "object") throw new AdapterHttpError("schema_changed", "job_invalid");
    const job = value as Record<string, unknown>;
    if (!Number.isInteger(job.id) || typeof job.title !== "string" || typeof job.absolute_url !== "string") {
      throw new AdapterHttpError("schema_changed", "job_fields_invalid");
    }
    if (job.location !== undefined && (!job.location || typeof job.location !== "object")) {
      throw new AdapterHttpError("schema_changed", "location_invalid");
    }
    return job as unknown as GreenhouseJob;
  });
}

function matches(query: QueryDefinition, vacancy: { title: string; location: string; description: string; organization: string }): boolean {
  const haystack = `${vacancy.title} ${vacancy.location} ${vacancy.description} ${vacancy.organization}`.toLowerCase();
  if (query.exclusions.some((term) => haystack.includes(term.toLowerCase()))) return false;
  return query.terms.some((term) => haystack.includes(term.toLowerCase()));
}

function validatePublicJobUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new AdapterHttpError("schema_changed", "job_url_invalid");
  url.hash = "";
  return url.toString();
}
