import type { NormalizedObservation, QueryDefinition } from "../domain/types";
import type { RelevanceProfile } from "../portfolio/sources";
import { deterministicGate } from "./deterministic-gate";
import { earlySignal } from "./early-signal";
import { finalDecision } from "./final-decision";
import { heuristicScore } from "./heuristic-score";
import { idempotencyKey } from "../domain/ids";
import { persistDecisionAndIntent } from "../storage/decisions";

export async function evaluateAndPersist(
  db: D1Database,
  input: {
    vacancyId: string;
    observation: NormalizedObservation;
    discoveryQuery: QueryDefinition;
    profile: RelevanceProfile;
    now?: Date;
    channel?: string;
    destinationKey?: string;
  },
): Promise<{ outcome: "alert" | "discard"; decisionId: string }> {
  const now = input.now ?? new Date();
  const profileQuery: QueryDefinition = {
    ...input.discoveryQuery,
    id: "profile-core",
    terms: [...input.profile.roles, ...input.profile.technologies],
    exclusions: input.profile.exclusions,
    active: true,
  };
  const baseGate = deterministicGate(input.observation, profileQuery);
  const text = `${input.observation.title} ${input.observation.descriptionSummary ?? ""}`.toLowerCase();
  const matchedRoles = input.profile.roles.filter((term) => text.includes(term.toLowerCase())).length;
  const matchedTechnologies = input.profile.technologies.filter((term) => text.includes(term.toLowerCase())).length;
  const gate = baseGate.eligible && matchedRoles === 0
    ? { ...baseGate, eligible: false, reasonCode: "profile_mismatch" as const }
    : baseGate;
  const freshness = heuristicScore(input.observation, [], now).features.freshness;
  const score = gate.eligible
    ? {
        value: Math.min(1, 0.65 + (matchedTechnologies / Math.max(1, input.profile.technologies.length)) * 0.2 + freshness * 0.15),
        features: { matchedRoles, matchedTechnologies, freshness },
        ruleVersion: "heuristic-profile-v1",
      }
    : { value: 0, features: { matchedRoles, matchedTechnologies, freshness }, ruleVersion: "heuristic-profile-v1" };
  const provisional = gate.eligible && score.value >= 0.5
    ? await earlySignal(input.observation, gate)
    : null;
  const decision = finalDecision(score, provisional, 0.6);
  const decisionId = await idempotencyKey([
    "decision",
    input.vacancyId,
    input.discoveryQuery.id,
    input.discoveryQuery.revision,
    gate.ruleVersion,
    score.ruleVersion,
    decision.ruleVersion,
  ]);
  await persistDecisionAndIntent(db, {
    decisionId,
    vacancyId: input.vacancyId,
    queryId: input.discoveryQuery.id,
    gate,
    score,
    decision,
    earlySignalKey: provisional?.idempotencyKey,
    roundId: input.observation.roundId,
    channel: input.channel ?? "pending_configuration",
    destinationKey: input.destinationKey ?? "pending_configuration",
    payload: {
      vacancyId: input.vacancyId,
      title: input.observation.title,
      organization: input.observation.organization ?? null,
      location: input.observation.location ?? null,
      source: input.observation.sourceId,
      canonicalUrl: input.observation.canonicalUrl,
      stage: "final",
      outcome: decision.outcome,
      earlySignalKey: provisional?.idempotencyKey ?? null,
    },
    now: now.toISOString(),
  });
  return { outcome: decision.outcome, decisionId };
}
