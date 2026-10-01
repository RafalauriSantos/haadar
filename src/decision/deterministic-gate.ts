import type { NormalizedObservation, QueryDefinition } from "../domain/types";

export interface GateResult {
  eligible: boolean;
  reasonCode: "eligible" | "excluded_title" | "inactive_query" | "missing_identity" | "profile_mismatch" | "seniority_not_explicit";
  ruleVersion: string;
}

function hasExplicitEntryLevel(title: string): boolean {
  const normalized = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /(?:^|[^\p{L}\p{N}])(junior|jr|estagio|estagiario|estagiaria|intern|internship|trainee|entry[- ]level|associate|software engineer i|developer i|desenvolvedor i)(?=$|[^\p{L}\p{N}])/u.test(normalized);
}

export function deterministicGate(observation: NormalizedObservation, query: QueryDefinition): GateResult {
  if (!query.active) return { eligible: false, reasonCode: "inactive_query", ruleVersion: "gate-v2" };
  if (!observation.canonicalUrl || !observation.title) return { eligible: false, reasonCode: "missing_identity", ruleVersion: "gate-v2" };
  const normalizedTitle = observation.title.toLowerCase();
  if (query.exclusions.some((term) => normalizedTitle.includes(term.toLowerCase()))) {
    return { eligible: false, reasonCode: "excluded_title", ruleVersion: "gate-v2" };
  }
  if (!hasExplicitEntryLevel(observation.title)) {
    return { eligible: false, reasonCode: "seniority_not_explicit", ruleVersion: "gate-v2" };
  }
  return { eligible: true, reasonCode: "eligible", ruleVersion: "gate-v2" };
}
