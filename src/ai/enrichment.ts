export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface EnrichmentResult {
  status: "completed" | "fallback";
  model: string;
  promptVersion: string;
  output: Record<string, unknown> | null;
  fallbackReason?: "unavailable" | "invalid_schema" | "budget_blocked";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function enrichWithAi(
  input: Record<string, unknown>,
  aiBinding: AiBinding | undefined,
  options: { model: string; promptVersion: string; allowedModels: string[]; budgetAllowed: boolean }
): Promise<EnrichmentResult> {
  if (!options.budgetAllowed) return { status: "fallback", model: options.model, promptVersion: options.promptVersion, output: null, fallbackReason: "budget_blocked" };
  if (!aiBinding || !options.allowedModels.includes(options.model)) return { status: "fallback", model: options.model, promptVersion: options.promptVersion, output: null, fallbackReason: "unavailable" };
  try {
    const output = await aiBinding.run(options.model, input);
    if (!isRecord(output)) throw new Error("invalid_schema");
    return { status: "completed", model: options.model, promptVersion: options.promptVersion, output };
  } catch {
    return { status: "fallback", model: options.model, promptVersion: options.promptVersion, output: null, fallbackReason: "invalid_schema" };
  }
}
