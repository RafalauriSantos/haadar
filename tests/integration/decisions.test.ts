import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { evaluateAndPersist } from "../../src/decision/pipeline";
import { persistCanonicalObservation } from "../../src/storage/d1";
import { defaultRelevanceProfile } from "../../src/portfolio/sources";
import { initialQueries } from "../../src/portfolio/query-portfolio";

const now = new Date("2026-10-05T12:00:00.000Z");

async function persist(input: { id: string; title: string; description?: string; publishedAt?: string }) {
  const observation = {
    sourceId: "greenhouse:test",
    sourceVacancyId: input.id,
    canonicalUrl: `https://job-boards.greenhouse.io/test/jobs/${input.id}`,
    title: input.title,
    organization: "Test Company",
    location: "Remote - Brazil",
    workModel: "remote" as const,
    descriptionSummary: input.description,
    publishedAt: input.publishedAt,
    observedAt: now.toISOString(),
    queryId: "role-backend",
    fingerprint: `fingerprint-${input.id}`,
    fingerprintVersion: "v1",
    originKind: "real" as const,
  };
  return { observation, vacancyId: await persistCanonicalObservation(env.DB, observation) };
}

describe("persisted decisions and early intents", () => {
  it("alerts for a profile role found outside the title without requiring a stack title", async () => {
    const { observation, vacancyId } = await persist({
      id: "profile-description",
      title: "Product Engineer",
      description: "Work on backend services using Java and PostgreSQL.",
    });
    const result = await evaluateAndPersist(env.DB, {
      vacancyId,
      observation,
      discoveryQuery: initialQueries.find((query) => query.id === "broad-software")!,
      profile: defaultRelevanceProfile,
      now,
    });
    expect(result.outcome).toBe("alert");
    const intent = await env.DB.prepare(
      "SELECT stage, status, early_signal_key FROM alert_intents WHERE vacancy_id = ?",
    ).bind(vacancyId).first<{ stage: string; status: string; early_signal_key: string }>();
    expect(intent).toMatchObject({ stage: "final", status: "pending" });
    expect(intent?.early_signal_key).toBeTruthy();
  });

  it("persists exclusion evidence without creating an alert intent", async () => {
    const { observation, vacancyId } = await persist({ id: "excluded", title: "Principal Backend Engineer" });
    const result = await evaluateAndPersist(env.DB, {
      vacancyId,
      observation,
      discoveryQuery: initialQueries.find((query) => query.id === "role-backend")!,
      profile: defaultRelevanceProfile,
      now,
    });
    expect(result.outcome).toBe("discard");
    const decision = await env.DB.prepare(
      "SELECT gate_eligible, gate_reason FROM decision_records WHERE id = ?",
    ).bind(result.decisionId).first<{ gate_eligible: number; gate_reason: string }>();
    expect(decision).toMatchObject({ gate_eligible: 0, gate_reason: "excluded_title" });
    expect(await env.DB.prepare("SELECT idempotency_key FROM alert_intents WHERE vacancy_id = ?").bind(vacancyId).first()).toBeNull();
  });

  it("keeps one intent across query attribution and preserves both decisions", async () => {
    const { observation, vacancyId } = await persist({ id: "cross-query", title: "Backend Software Developer" });
    for (const queryId of ["role-backend", "broad-software"]) {
      await evaluateAndPersist(env.DB, {
        vacancyId,
        observation: { ...observation, queryId },
        discoveryQuery: initialQueries.find((query) => query.id === queryId)!,
        profile: defaultRelevanceProfile,
        now,
      });
    }
    const decisions = await env.DB.prepare("SELECT COUNT(*) AS count FROM decision_records WHERE vacancy_id = ?")
      .bind(vacancyId).first<{ count: number }>();
    const intents = await env.DB.prepare("SELECT COUNT(*) AS count FROM alert_intents WHERE vacancy_id = ?")
      .bind(vacancyId).first<{ count: number }>();
    expect(decisions?.count).toBe(2);
    expect(intents?.count).toBe(1);
  });

  it("records old and missing timestamps without treating presence as fresh", async () => {
    for (const item of [
      { id: "old", publishedAt: "2026-08-01T00:00:00.000Z" },
      { id: "missing", publishedAt: undefined },
    ]) {
      const { observation, vacancyId } = await persist({ ...item, title: "Backend Developer" });
      const result = await evaluateAndPersist(env.DB, {
        vacancyId,
        observation,
        discoveryQuery: initialQueries.find((query) => query.id === "role-backend")!,
        profile: defaultRelevanceProfile,
        now,
      });
      const row = await env.DB.prepare("SELECT score_features_json FROM decision_records WHERE id = ?")
        .bind(result.decisionId).first<{ score_features_json: string }>();
      expect(JSON.parse(row!.score_features_json).freshness).toBe(0);
    }
  });

  it("keeps a new decision when the discovery rule revision changes", async () => {
    const { observation, vacancyId } = await persist({ id: "rule-revision", title: "Backend Developer" });
    const query = initialQueries.find((item) => item.id === "role-backend")!;
    const first = await evaluateAndPersist(env.DB, { vacancyId, observation, discoveryQuery: query, profile: defaultRelevanceProfile, now });
    const second = await evaluateAndPersist(env.DB, { vacancyId, observation, discoveryQuery: { ...query, revision: "2" }, profile: defaultRelevanceProfile, now });
    expect(second.decisionId).not.toBe(first.decisionId);
  });
});
