import type { BudgetState } from "../domain/types";
import type { AiBinding, EnrichmentResult } from "../ai/enrichment";
import { enrichWithAi } from "../ai/enrichment";

export interface EnrichmentInput {
  candidate: Record<string, unknown>;
  budgetState: BudgetState;
  aiBinding?: AiBinding;
}

export async function runSelectiveEnrichment(input: EnrichmentInput): Promise<EnrichmentResult> {
  const allowed = input.budgetState === "NORMAL" || input.budgetState === "CONSERVATIVE";
  return enrichWithAi(input.candidate, input.aiBinding, {
    model: "@cf/zai-org/glm-4.7-flash",
    promptVersion: "enrichment-v1",
    allowedModels: ["@cf/zai-org/glm-4.7-flash"],
    budgetAllowed: allowed
  });
}
