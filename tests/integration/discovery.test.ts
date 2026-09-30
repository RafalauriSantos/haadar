import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { admitRound } from "../../src/discovery/round-coordinator";
import { markTaskPublished, persistCanonicalObservation } from "../../src/storage/d1";

const usage = {
  workersRequests: 0,
  queueOperations: 0,
  d1RowsRead: 0,
  d1RowsWritten: 0,
  workflowSteps: 0,
  aiNeurons: 0,
};

const portfolio = {
  revision: "portfolio-reliable-v1",
  queries: [
    { id: "role-backend", revision: "1", family: "ROLE" as const, terms: ["backend"], exclusions: [], priority: 10, estimatedCost: 1, active: true },
    { id: "broad-junior", revision: "1", family: "BROAD" as const, terms: ["junior"], exclusions: [], priority: 5, estimatedCost: 1, active: true },
  ],
};

const scheduledAt = new Date("2026-10-01T04:40:00.000Z");
const firstNow = new Date("2026-10-01T04:41:00.000Z");

describe("reliable discovery identity", () => {
  it("admits one concurrent round and preserves its first portfolio and budget", async () => {
    const [first, second] = await Promise.all([
      admitRound({ db: env.DB, scheduledAt, portfolio, usage, adapterIds: ["fixture"], now: firstNow }),
      admitRound({ db: env.DB, scheduledAt, portfolio, usage, adapterIds: ["fixture"], now: firstNow }),
    ]);

    expect(first.round.id).toBe(second.round.id);
    expect(first.round.portfolioRevision).toBe("portfolio-reliable-v1");
    expect(first.round.budgetState).toBe("NORMAL");
    expect(first.tasks.length + second.tasks.length).toBe(2);

    const retry = await admitRound({
      db: env.DB,
      scheduledAt,
      portfolio: { ...portfolio, revision: "portfolio-retry-v2", queries: portfolio.queries.slice(0, 1) },
      usage: { ...usage, queueOperations: 7_600 },
      adapterIds: ["fixture"],
      now: new Date(firstNow.getTime() + 1_000),
    });
    expect(retry.round.portfolioRevision).toBe("portfolio-reliable-v1");
    expect(retry.round.budgetState).toBe("NORMAL");
    expect(retry.tasks).toHaveLength(0);

    const snapshot = await env.DB.prepare(
      "SELECT revision, snapshot_json FROM portfolio_snapshots WHERE round_id = ?",
    ).bind(first.round.id).first<{ revision: string; snapshot_json: string }>();
    expect(snapshot?.revision).toBe("portfolio-reliable-v1");
    expect(JSON.parse(snapshot!.snapshot_json).queries).toHaveLength(2);
  });

  it("recovers a publication after its lease expires and stops after publish", async () => {
    const time = new Date("2026-10-01T06:01:00.000Z");
    const admission = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-01T06:00:00.000Z"),
      portfolio: { ...portfolio, revision: "lease-v1", queries: portfolio.queries.slice(0, 1) },
      usage,
      adapterIds: ["fixture"],
      now: time,
      publicationLeaseMs: 1_000,
    });
    expect(admission.tasks).toHaveLength(1);

    const duringLease = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-01T06:00:00.000Z"),
      portfolio: { ...portfolio, revision: "lease-v1", queries: portfolio.queries.slice(0, 1) },
      usage,
      adapterIds: ["fixture"],
      now: new Date(time.getTime() + 500),
      publicationLeaseMs: 1_000,
    });
    expect(duringLease.tasks).toHaveLength(0);

    const recovered = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-01T06:00:00.000Z"),
      portfolio: { ...portfolio, revision: "lease-v1", queries: portfolio.queries.slice(0, 1) },
      usage,
      adapterIds: ["fixture"],
      now: new Date(time.getTime() + 1_001),
      publicationLeaseMs: 1_000,
    });
    expect(recovered.tasks).toHaveLength(1);
    expect(await markTaskPublished(env.DB, recovered.tasks[0].id, recovered.tasks[0].publicationLeaseToken!)).toBe(true);

    const afterPublish = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-01T06:00:00.000Z"),
      portfolio: { ...portfolio, revision: "lease-v1", queries: portfolio.queries.slice(0, 1) },
      usage,
      adapterIds: ["fixture"],
      now: new Date(time.getTime() + 5_000),
    });
    expect(afterPublish.tasks).toHaveLength(0);

    const afterQueueStaleness = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-01T06:00:00.000Z"),
      portfolio: { ...portfolio, revision: "lease-v1", queries: portfolio.queries.slice(0, 1) },
      usage,
      adapterIds: ["fixture"],
      now: new Date(time.getTime() + 6_000),
      publicationStaleMs: 1_000,
    });
    expect(afterQueueStaleness.tasks).toHaveLength(1);
  });

  it("keeps one vacancy with multiple query occurrences and changing URLs", async () => {
    const admission = await admitRound({
      db: env.DB,
      scheduledAt: new Date("2026-10-01T07:30:00.000Z"),
      portfolio: { ...portfolio, revision: "occurrence-v1" },
      usage,
      adapterIds: ["fixture"],
      now: new Date("2026-10-01T07:31:00.000Z"),
    });
    const base = {
      sourceId: "public-ats",
      sourceVacancyId: "job-42",
      title: "Backend Developer",
      organization: "Example Org",
      observedAt: "2026-10-01T07:32:00.000Z",
      fingerprint: "fingerprint-stable",
      fingerprintVersion: "v1",
      roundId: admission.round.id,
      originKind: "real" as const,
    };
    const firstId = await persistCanonicalObservation(env.DB, {
      ...base,
      taskId: admission.tasks[0].id,
      queryId: admission.tasks[0].queryId,
      canonicalUrl: "https://jobs.example/old/job-42",
    });
    const secondId = await persistCanonicalObservation(env.DB, {
      ...base,
      taskId: admission.tasks[1].id,
      queryId: admission.tasks[1].queryId,
      canonicalUrl: "https://jobs.example/new/job-42",
    });
    expect(secondId).toBe(firstId);
    const occurrences = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM vacancy_occurrences WHERE vacancy_id = ?",
    ).bind(firstId).first<{ count: number }>();
    expect(occurrences?.count).toBe(2);
  });

  it("does not silently merge similar vacancies and records possible duplicate evidence", async () => {
    const common = {
      sourceId: "public-ats",
      title: "Junior Backend Developer",
      organization: "Similar Org",
      observedAt: "2026-10-01T09:00:00.000Z",
      queryId: "role-backend",
      originKind: "real" as const,
    };
    const firstId = await persistCanonicalObservation(env.DB, {
      ...common,
      sourceVacancyId: "similar-1",
      canonicalUrl: "https://jobs.example/similar-1",
      fingerprint: "similar-fingerprint-1",
    });
    const secondId = await persistCanonicalObservation(env.DB, {
      ...common,
      sourceVacancyId: "similar-2",
      canonicalUrl: "https://jobs.example/similar-2",
      fingerprint: "similar-fingerprint-2",
    });
    expect(secondId).not.toBe(firstId);
    const candidate = await env.DB.prepare(
      "SELECT reason FROM possible_duplicates WHERE vacancy_id = ? AND candidate_vacancy_id = ?",
    ).bind(secondId, firstId).first<{ reason: string }>();
    expect(candidate?.reason).toBe("same_title_and_organization");
  });

  it("reapplies tracked migrations without losing persisted data", async () => {
    const before = await env.DB.prepare("SELECT COUNT(*) AS count FROM discovery_rounds")
      .first<{ count: number }>();
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    const after = await env.DB.prepare("SELECT COUNT(*) AS count FROM discovery_rounds")
      .first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });
});
