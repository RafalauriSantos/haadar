import type { DiscoveryTask, NormalizedObservation } from "../domain/types";

export type AdapterFailureKind = "retryable" | "permanent" | "throttled" | "blocked" | "schema_changed";

export interface AdapterDiagnostic {
  kind: AdapterFailureKind;
  message: string;
}

export interface AdapterResult {
  sourceId: string;
  observations: NormalizedObservation[];
  diagnostics: AdapterDiagnostic[];
}

export interface SourceAdapter {
  readonly id: string;
  discover(task: DiscoveryTask): Promise<AdapterResult>;
}
