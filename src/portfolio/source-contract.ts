import type { SourceDefinition } from "./sources";

export type SourceAdapterKind = "public_json" | "public_html" | "public_rss";

/** Sample counts from normal collection only; this policy never schedules requests. */
export interface SourceCanaryPolicy {
  readonly minimumBaselineSamples: number;
  readonly baselineWindow: number;
  readonly anomalyAtOrBelow: number;
}

export const defaultSourceCanaryPolicy: SourceCanaryPolicy = Object.freeze({
  minimumBaselineSamples: 3,
  baselineWindow: 10,
  anomalyAtOrBelow: 0,
});

export interface SourceContract {
  kind: SourceAdapterKind;
  access: "public";
  fetchStrategy: "board_once";
  maxRequestsPerTask: 1;
}

function publicContract(kind: SourceAdapterKind): SourceContract {
  return { kind, access: "public", fetchStrategy: "board_once", maxRequestsPerTask: 1 };
}

export const sourceContracts: Record<SourceDefinition["adapterId"], SourceContract> = {
  greenhouse: publicContract("public_json"),
  "github-issues": publicContract("public_json"),
  gupy: publicContract("public_json"),
  trampos: publicContract("public_html"),
  "google-news-rss": publicContract("public_rss"),
  "linkedin-guest": publicContract("public_html"),
};

export function validateSourceContract(source: SourceDefinition): void {
  const fail = (field: string, requirement: string): never => {
    throw new RangeError(`Source contract ${field} ${requirement}`);
  };
  if (!Object.hasOwn(sourceContracts, source.adapterId)) fail("adapterId", "must have a registered public contract");
  if (!Array.isArray(source.allowedHosts) || source.allowedHosts.length === 0
    || source.allowedHosts.some((host) => typeof host !== "string" || host.trim().length === 0)) {
    fail("allowedHosts", "must contain non-empty hosts");
  }
  const contract = sourceContracts[source.adapterId];
  if (source.fetchStrategy !== contract.fetchStrategy) fail("fetchStrategy", "must be board_once");
  if (source.limits?.maxRequestsPerTask !== contract.maxRequestsPerTask) fail("maxRequestsPerTask", "must equal 1");
  for (const field of ["timeoutMs", "maxResponseBytes", "maxRecords"] as const) {
    if (!Number.isSafeInteger(source.limits[field]) || source.limits[field] <= 0) fail(field, "must be a positive safe integer");
  }
  const policy = source.canaryPolicy;
  if (!policy || !Number.isSafeInteger(policy.minimumBaselineSamples) || policy.minimumBaselineSamples <= 0
    || !Number.isSafeInteger(policy.baselineWindow) || policy.baselineWindow < policy.minimumBaselineSamples
    || !Number.isSafeInteger(policy.anomalyAtOrBelow) || policy.anomalyAtOrBelow < 0) {
    fail("canaryPolicy", "requires positive sample counts, a sufficient baselineWindow, and a non-negative anomalyAtOrBelow");
  }
}

export function validateSourceContracts(sources: SourceDefinition[]): void {
  for (const source of sources) validateSourceContract(source);
}
