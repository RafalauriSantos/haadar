import type { DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import type { GupySourceDefinition } from "../portfolio/sources";
import type { AdapterResult, SourceAdapter } from "./adapter";
import { AdapterHttpError, fetchBoundedText } from "./http";
import { explicitWorkModel, normalizeWhitespace, vacancyFingerprint } from "../normalization/vacancy";

export class GupyAdapter implements SourceAdapter {
  readonly id: string;
  readonly fetchStrategy = "board_once" as const;
  constructor(private readonly source: GupySourceDefinition, private readonly queries: QueryDefinition[], private readonly observedAt: () => Date = () => new Date(), private readonly fetcher: typeof fetch = fetch) { this.id = source.id; }
  async discover(_task: DiscoveryTask): Promise<AdapterResult> {
    try {
      const payload = await requestJobs(this.source, this.fetcher);
      const observations: NormalizedObservation[] = [];
      for (const job of payload) {
        const title = normalizeWhitespace(job.name);
        const description = normalizeWhitespace(job.description ?? "").slice(0, 4_000);
        const location = normalizeWhitespace([job.city, job.state].filter(Boolean).join(", "));
        const url = publicJobUrl(job);
        const matching = this.queries.filter((q) => this.source.applicableQueryFamilies.includes(q.family) && matches(q, `${title} ${description} ${location} ${job.careerPageName ?? ""}`));
        const fingerprint = await vacancyFingerprint({ organization: job.careerPageName ?? "Gupy", title, location, description });
        for (const query of matching) observations.push({ sourceId: this.source.id, sourceVacancyId: String(job.id), canonicalUrl: url, title, organization: job.careerPageName ?? "Gupy", location: location || undefined, workModel: explicitWorkModel(location, description), descriptionSummary: description || undefined, observedAt: this.observedAt().toISOString(), queryId: query.id, fingerprint, fingerprintVersion: "v1", originKind: "real" });
      }
      return { sourceId: this.id, observations, diagnostics: [] };
    } catch (error) { return { sourceId: this.id, observations: [], diagnostics: [{ kind: error instanceof AdapterHttpError ? error.kind : "schema_changed", message: error instanceof AdapterHttpError ? error.message : "gupy_payload_invalid" }] }; }
  }
}

interface GupyJob { id: number; name: string; description?: string; careerPageName?: string; city?: string; state?: string; jobUrl?: string; }
async function requestJobs(source: GupySourceDefinition, fetcher: typeof fetch): Promise<GupyJob[]> {
  try {
    const text = await fetchBoundedText("https://candidates.mcp.api.gupy.io/mcp", {
      allowedHosts: source.allowedHosts,
      timeoutMs: source.limits.timeoutMs,
      maxBytes: source.limits.maxResponseBytes,
      method: "POST",
      headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "user-agent": "Haadar vacancy discovery" },
      expectedContentTypes: ["application/json", "text/event-stream"],
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "search_jobs", arguments: { term: source.term, limit: source.limits.maxRecords } } }),
      fetcher,
    });
    const event = text.split("\n").find((line) => line.startsWith("data:")); if (!event) throw new AdapterHttpError("schema_changed", "sse_data_missing");
    const data = JSON.parse(event.slice(5).trim()) as { result?: { content?: Array<{ text?: string }> } }; const jobs = JSON.parse(data.result?.content?.[0]?.text ?? "{}")?.data?.data;
    if (!Array.isArray(jobs) || jobs.length > source.limits.maxRecords) throw new AdapterHttpError("schema_changed", "jobs_array_missing");
    return jobs.map((job) => { if (!job || typeof job !== "object" || !Number.isInteger(job.id) || typeof job.name !== "string") throw new AdapterHttpError("schema_changed", "job_fields_invalid"); return job as GupyJob; });
  } catch (error) { throw error; }
}
function matches(query: QueryDefinition, text: string): boolean { const haystack = text.toLowerCase(); return !query.exclusions.some((term) => haystack.includes(term.toLowerCase())) && query.terms.some((term) => haystack.includes(term.toLowerCase())); }
function publicJobUrl(job: GupyJob): string { if (job.jobUrl) { const url = new URL(job.jobUrl); if (url.protocol === "https:" && !url.username && !url.password) return url.toString(); } if (job.careerPageName) return `https://${encodeURIComponent(job.careerPageName.toLowerCase())}.gupy.io/jobs/${job.id}`; throw new AdapterHttpError("schema_changed", "job_url_missing"); }
