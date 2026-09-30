import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { enrichWithAi, type AiBinding } from "../ai/enrichment";
import type { BudgetState } from "../domain/types";

export interface EnrichmentWorkflowParams {
  instanceId: string;
  vacancyId: string;
  decisionId: string;
  candidate: {
    title: string;
    organization?: string;
    descriptionSummary?: string;
  };
  budgetAllowed: boolean;
  aiEnabled: boolean;
}

export interface WorkflowEnv {
  DB: D1Database;
  AI?: AiBinding;
}

interface EnrichmentStepResult {
  status: "completed" | "fallback";
  model: string;
  promptVersion: string;
  outputJson: string | null;
  fallbackReason: "unavailable" | "invalid_schema" | "budget_blocked" | null;
}

export class EnrichmentWorkflow extends WorkflowEntrypoint<WorkflowEnv, EnrichmentWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<EnrichmentWorkflowParams>>, step: WorkflowStep): Promise<unknown> {
    const input = await step.do("validate-candidate", async () => validateParams(event.payload));
    const result = await step.do<EnrichmentStepResult>(
      "optional-ai-enrichment",
      { retries: { limit: 1, delay: "10 seconds", backoff: "linear" }, timeout: "30 seconds" },
      async () => {
        const enrichment = await enrichWithAi(input.candidate, input.aiEnabled ? this.env.AI : undefined, {
          model: "disabled-until-free-model-approved",
          promptVersion: "enrichment-v2",
          allowedModels: [],
          budgetAllowed: input.budgetAllowed && input.aiEnabled,
        });
        return {
          status: enrichment.status,
          model: enrichment.model,
          promptVersion: enrichment.promptVersion,
          outputJson: enrichment.output ? JSON.stringify(enrichment.output) : null,
          fallbackReason: enrichment.fallbackReason ?? null,
        };
      },
    );
    return step.do("persist-enrichment-provenance", async () => {
      const now = new Date().toISOString();
      await this.env.DB.prepare(
        `INSERT INTO enrichment_runs
          (instance_id, vacancy_id, decision_id, status, model, prompt_version,
           validation_status, fallback_reason, output_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           status = excluded.status,
           validation_status = excluded.validation_status,
           fallback_reason = excluded.fallback_reason,
           output_json = excluded.output_json,
           updated_at = excluded.updated_at`,
      ).bind(
        input.instanceId,
        input.vacancyId,
        input.decisionId,
        result.status,
        result.model,
        result.promptVersion,
        result.status === "completed" ? "valid" : "fallback",
        result.fallbackReason,
        result.outputJson,
        now,
        now,
      ).run();
      return { status: result.status, fallbackReason: result.fallbackReason ?? null };
    });
  }
}

function validateParams(params: EnrichmentWorkflowParams): EnrichmentWorkflowParams {
  const fields = [params.instanceId, params.vacancyId, params.decisionId, params.candidate?.title];
  if (fields.some((value) => typeof value !== "string" || value.length === 0 || value.length > 256)) {
    throw new TypeError("invalid_enrichment_identity");
  }
  if ((params.candidate.descriptionSummary?.length ?? 0) > 4_000 || (params.candidate.organization?.length ?? 0) > 256) {
    throw new RangeError("enrichment_input_too_large");
  }
  return params;
}

export async function runSelectiveEnrichment(input: {
  candidate: Record<string, unknown>;
  budgetState: BudgetState;
  aiBinding?: AiBinding;
}) {
  const allowed = input.budgetState === "NORMAL" || input.budgetState === "CONSERVATIVE";
  return enrichWithAi(input.candidate, input.aiBinding, {
    model: "disabled-until-free-model-approved",
    promptVersion: "enrichment-v2",
    allowedModels: [],
    budgetAllowed: allowed,
  });
}
