import type { DiscoveryTask, NormalizedObservation } from "../domain/types";
import type { SourceAdapter } from "./adapter";

export class FixtureAdapter implements SourceAdapter {
  readonly id = "fixture";

  async discover(task: DiscoveryTask) {
    const base: Omit<NormalizedObservation, "canonicalUrl" | "fingerprint"> = {
      sourceId: this.id,
      title: "Backend TypeScript Developer",
      organization: "Example Labs",
      location: "Remote",
      workModel: "remote",
      observedAt: "2026-09-30T01:30:10.000Z",
      queryId: task.queryId
    };
    return {
      sourceId: this.id,
      observations: [
        { ...base, sourceVacancyId: "vacancy-1", canonicalUrl: "https://jobs.example/vacancy-1", fingerprint: "fingerprint-1" },
        { ...base, sourceVacancyId: "vacancy-1", canonicalUrl: "https://jobs.example/vacancy-1", fingerprint: "fingerprint-1" }
      ],
      diagnostics: [{ kind: "retryable" as const, message: "fixture retry sample" }]
    };
  }
}
