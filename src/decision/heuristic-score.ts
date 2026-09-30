import type { NormalizedObservation } from "../domain/types";

export interface HeuristicScore {
  value: number;
  features: Record<string, number>;
  ruleVersion: string;
}

export function heuristicScore(observation: NormalizedObservation, queryTerms: string[], now = new Date()): HeuristicScore {
  const text = `${observation.title} ${observation.descriptionSummary ?? ""}`.toLowerCase();
  const matchedTerms = queryTerms.filter((term) => text.includes(term.toLowerCase())).length;
  const freshness = freshnessFeature(observation.publishedAt, now);
  const value = Math.min(1, (matchedTerms / Math.max(1, queryTerms.length)) * 0.8 + freshness * 0.2);
  return { value, features: { matchedTerms, freshness }, ruleVersion: "heuristic-v1" };
}

function freshnessFeature(publishedAt: string | undefined, now: Date): number {
  if (!publishedAt || !Number.isFinite(now.getTime())) return 0;
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published) || published > now.getTime()) return 0;
  const ageDays = (now.getTime() - published) / 86_400_000;
  if (ageDays <= 3) return 1;
  if (ageDays <= 14) return 0.5;
  return 0;
}
