import type { QueryDefinition, QueryFamily } from "../domain/types";

export interface PortfolioState {
  now: string;
  allowExperimental: boolean;
}

export class QueryPortfolio {
  constructor(private readonly revision: string, private readonly definitions: QueryDefinition[]) {}

  activeRevision(): string { return this.revision; }

  admit(state: PortfolioState): QueryDefinition[] {
    return this.definitions
      .filter((query) => query.active)
      .filter((query) => !query.cooldownUntil || query.cooldownUntil <= state.now)
      .filter((query) => state.allowExperimental || query.family !== "EXPERIMENTAL")
      .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  }
}

export function queryFamily(value: string): QueryFamily {
  const families: QueryFamily[] = ["BROAD", "ROLE", "STACK", "CONTEXT", "COMPANY", "EXPERIMENTAL"];
  if (!families.includes(value as QueryFamily)) throw new Error(`Unknown query family: ${value}`);
  return value as QueryFamily;
}
