import { env } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("durable enrichment workflow", () => {
  it("persists completed steps and falls back when optional AI is disabled", async () => {
    const instanceId = "workflow-resume-1";
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO vacancies
          (id, canonical_url, title, work_model, fingerprint, fingerprint_version,
           first_observed_at, last_observed_at, created_at, updated_at)
         VALUES ('workflow-vacancy', 'https://jobs.example/workflow', 'Backend Developer', 'remote',
           'workflow-fingerprint', 'v1', ?, ?, ?, ?)`,
      ).bind("2026-10-06T00:00:00.000Z", "2026-10-06T00:00:00.000Z", "2026-10-06T00:00:00.000Z", "2026-10-06T00:00:00.000Z"),
      env.DB.prepare(
        `INSERT INTO decision_records
          (id, vacancy_id, query_id, gate_rule_version, gate_eligible, gate_reason,
           score_rule_version, score, score_features_json, outcome, decision_rule_version,
           decision_reason, created_at)
         VALUES ('workflow-decision', 'workflow-vacancy', 'role-backend', 'gate-v1', 1, 'eligible',
           'score-v1', 0.8, '{}', 'alert', 'decision-v1', 'heuristic_threshold', ?)`,
      ).bind("2026-10-06T00:00:00.000Z"),
    ]);

    await using introspector = await introspectWorkflowInstance(env.ENRICHMENT_WORKFLOW, instanceId);
    await env.ENRICHMENT_WORKFLOW.create({
      id: instanceId,
      params: {
        instanceId,
        vacancyId: "workflow-vacancy",
        decisionId: "workflow-decision",
        candidate: { title: "Backend Developer", descriptionSummary: "TypeScript" },
        budgetAllowed: true,
        aiEnabled: false,
      },
    });
    expect(await introspector.waitForStepResult({ name: "validate-candidate" })).toMatchObject({ vacancyId: "workflow-vacancy" });
    await introspector.waitForStatus("complete");
    expect(await introspector.getOutput()).toEqual({ status: "fallback", fallbackReason: "budget_blocked" });
    const stored = await env.DB.prepare(
      "SELECT status, fallback_reason, prompt_version FROM enrichment_runs WHERE instance_id = ?",
    ).bind(instanceId).first<{ status: string; fallback_reason: string; prompt_version: string }>();
    expect(stored).toEqual({ status: "fallback", fallback_reason: "budget_blocked", prompt_version: "enrichment-v2" });
  });
});
