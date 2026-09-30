import type { NormalizedObservation, QueryDefinition } from "../domain/types";

export interface GateResult {
  eligible: boolean;
  reasonCode: "eligible" | "excluded_title" | "inactive_query" | "missing_identity";
  ruleVersion: string;
}

export function deterministicGate(observation: NormalizedObservation, query: QueryDefinition): GateResult {
  if (!query.active) return { eligible: false, reasonCode: "inactive_query", ruleVersion: "gate-v1" };
  if (!observation.canonicalUrl || !observation.title) return { eligible: false, reasonCode: "missing_identity", ruleVersion: "gate-v1" };
  const normalizedTitle = observation.title.toLowerCase();
  if (query.exclusions.some((term) => normalizedTitle.includes(term.toLowerCase()))) {
    return { eligible: false, reasonCode: "excluded_title", ruleVersion: "gate-v1" };
  }
  return { eligible: true, reasonCode: "eligible", ruleVersion: "gate-v1" };
}
