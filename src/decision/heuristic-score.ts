import type { NormalizedObservation } from "../domain/types";

export interface HeuristicScore {
  value: number;
  features: Record<string, number>;
  ruleVersion: string;
}

export function heuristicScore(observation: NormalizedObservation, queryTerms: string[]): HeuristicScore {
  const text = `${observation.title} ${observation.descriptionSummary ?? ""}`.toLowerCase();
  const matchedTerms = queryTerms.filter((term) => text.includes(term.toLowerCase())).length;
  const freshness = observation.publishedAt ? 1 : 0;
  const value = Math.min(1, (matchedTerms / Math.max(1, queryTerms.length)) * 0.8 + freshness * 0.2);
  return { value, features: { matchedTerms, freshness }, ruleVersion: "heuristic-v1" };
}
