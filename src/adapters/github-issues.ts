import type { DiscoveryTask, NormalizedObservation, QueryDefinition } from "../domain/types";
import type { GitHubIssuesSourceDefinition } from "../portfolio/sources";
import type { AdapterResult, SourceAdapter } from "./adapter";
import { AdapterHttpError, fetchBoundedJson } from "./http";
import { explicitWorkModel, normalizeWhitespace, vacancyFingerprint } from "../normalization/vacancy";

interface GitHubIssue {
  id: number;
  title: string;
  body?: string | null;
  html_url: string;
  created_at: string;
  pull_request?: object;
}

export class GitHubIssuesAdapter implements SourceAdapter {
  readonly id: string;
  readonly fetchStrategy = "board_once" as const;

  constructor(
    private readonly source: GitHubIssuesSourceDefinition,
    private readonly queries: QueryDefinition[],
    private readonly observedAt: () => Date = () => new Date(),
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.id = source.id;
  }

  async discover(_task: DiscoveryTask): Promise<AdapterResult> {
    try {
      const payload = await fetchBoundedJson(
        `https://api.github.com/repos/${this.source.repository}/issues?state=open&sort=created&direction=desc&per_page=${this.source.limits.maxRecords}`,
        {
          ...this.source.limits,
          maxBytes: this.source.limits.maxResponseBytes,
          allowedHosts: this.source.allowedHosts,
          headers: { "x-github-api-version": "2022-11-28", "user-agent": "Haadar vacancy discovery" },
          fetcher: this.fetcher,
        },
      );
      const issues = parseIssues(payload, this.source.limits.maxRecords);
      const observations: NormalizedObservation[] = [];
      const observedAt = this.observedAt().toISOString();
      for (const issue of issues) {
        if (issue.pull_request) continue;
        const title = normalizeWhitespace(issue.title);
        const description = normalizeWhitespace(issue.body ?? "").slice(0, 4_000);
        const url = validateIssueUrl(issue.html_url, this.source.repository);
        const matchingQueries = this.queries.filter((query) => this.source.applicableQueryFamilies.includes(query.family) && matches(query, {
          title,
          description,
          organization: this.source.organization,
        }));
        const fingerprint = await vacancyFingerprint({ organization: this.source.organization, title, description });
        for (const query of matchingQueries) {
          observations.push({
            sourceId: this.source.id,
            sourceVacancyId: String(issue.id),
            canonicalUrl: url,
            title,
            organization: this.source.organization,
            workModel: explicitWorkModel(title, description),
            descriptionSummary: description || undefined,
            publishedAt: new Date(issue.created_at).toISOString(),
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
      return { sourceId: this.source.id, observations: [], diagnostics: [{ kind: "schema_changed", message: "github_issues_payload_invalid" }] };
    }
  }
}

function parseIssues(payload: unknown, maxRecords: number): GitHubIssue[] {
  if (!Array.isArray(payload)) throw new AdapterHttpError("schema_changed", "issues_array_missing");
  if (payload.length > maxRecords) throw new AdapterHttpError("permanent", "record_limit_exceeded");
  return payload.map((value) => {
    if (!value || typeof value !== "object") throw new AdapterHttpError("schema_changed", "issue_invalid");
    const issue = value as Record<string, unknown>;
    if (!Number.isInteger(issue.id) || typeof issue.title !== "string" || typeof issue.html_url !== "string" || typeof issue.created_at !== "string" || (issue.body !== undefined && issue.body !== null && typeof issue.body !== "string")) {
      throw new AdapterHttpError("schema_changed", "issue_fields_invalid");
    }
    if (!Number.isFinite(Date.parse(issue.created_at))) throw new AdapterHttpError("schema_changed", "issue_created_at_invalid");
    if (issue.pull_request !== undefined && (!issue.pull_request || typeof issue.pull_request !== "object")) {
      throw new AdapterHttpError("schema_changed", "pull_request_invalid");
    }
    return issue as unknown as GitHubIssue;
  });
}

function matches(query: QueryDefinition, vacancy: { title: string; description: string; organization: string }): boolean {
  const haystack = `${vacancy.title} ${vacancy.description} ${vacancy.organization}`.toLowerCase();
  if (query.exclusions.some((term) => haystack.includes(term.toLowerCase()))) return false;
  return query.terms.some((term) => haystack.includes(term.toLowerCase()));
}

function validateIssueUrl(value: string, repository: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || !new RegExp(`^/${escapeRegExp(repository)}/issues/\\d+$`).test(url.pathname)) {
    throw new AdapterHttpError("schema_changed", "issue_url_invalid");
  }
  url.hash = "";
  return url.toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
