import { describe, expect, it } from "vitest";
import { deterministicGate } from "../../src/decision/deterministic-gate";
import { earlySignal } from "../../src/decision/early-signal";
import { heuristicScore } from "../../src/decision/heuristic-score";
import { finalDecision } from "../../src/decision/final-decision";
import type { NormalizedObservation, QueryDefinition } from "../../src/domain/types";

const query: QueryDefinition = { id: "role-1", revision: "1", family: "ROLE", terms: ["backend", "typescript"], exclusions: ["senior"], priority: 10, estimatedCost: 1, active: true };
const observation: NormalizedObservation = { sourceId: "fixture", canonicalUrl: "https://jobs.example/1", title: "Backend TypeScript Developer", observedAt: "2026-09-30T01:30:00.000Z", queryId: query.id, fingerprint: "fp-1" };

describe("decision pipeline", () => {
  it("follows gate, provisional Early Signal, heuristic score, and Final Decision", async () => {
    const gate = deterministicGate(observation, query);
    const signal = await earlySignal(observation, gate);
    const score = heuristicScore(observation, query.terms);
    const decision = finalDecision(score, signal);

    expect(gate.eligible).toBe(true);
    expect(signal?.status).toBe("provisional");
    expect(score.value).toBe(0.8);
    expect(decision.outcome).toBe("alert");
    expect(decision.earlySignalKey).toBe(signal?.idempotencyKey);
  });

  it("does not signal an excluded observation", async () => {
    const excluded = { ...observation, title: "Senior Backend TypeScript Developer" };
    const gate = deterministicGate(excluded, query);
    expect(gate.eligible).toBe(false);
    expect(await earlySignal(excluded, gate)).toBeNull();
  });

  it("keeps finalization idempotent through the same early-signal key", async () => {
    const gate = deterministicGate(observation, query);
    const firstSignal = await earlySignal(observation, gate);
    const secondSignal = await earlySignal(observation, gate);
    expect(firstSignal?.idempotencyKey).toBe(secondSignal?.idempotencyKey);
  });

  it("calculates freshness from age instead of timestamp presence", () => {
    const now = new Date("2026-09-30T12:00:00.000Z");
    expect(heuristicScore({ ...observation, publishedAt: "2026-09-01T00:00:00.000Z" }, query.terms, now).features.freshness).toBe(0);
    expect(heuristicScore({ ...observation, publishedAt: "2026-10-01T00:00:00.000Z" }, query.terms, now).features.freshness).toBe(0);
    expect(heuristicScore({ ...observation, publishedAt: "invalid" }, query.terms, now).features.freshness).toBe(0);
    expect(heuristicScore({ ...observation, publishedAt: "2026-09-29T12:00:00.000Z" }, query.terms, now).features.freshness).toBe(1);
  });
});
