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

export const initialQueries: QueryDefinition[] = [
  { id: "broad-software", revision: "1", family: "BROAD", terms: ["software", "developer", "engineer"], exclusions: [], priority: 70, estimatedCost: 1, active: true },
  { id: "role-backend", revision: "1", family: "ROLE", terms: ["backend", "back-end", "software engineer"], exclusions: [], priority: 100, estimatedCost: 1, active: true },
  { id: "stack-core", revision: "1", family: "STACK", terms: ["node.js", "typescript", "java", "spring", "postgresql"], exclusions: [], priority: 80, estimatedCost: 1, active: true },
  { id: "context-remote-latam", revision: "1", family: "CONTEXT", terms: ["remote", "brazil", "latam", "latin america"], exclusions: [], priority: 90, estimatedCost: 1, active: true },
  { id: "company-planetscale", revision: "1", family: "COMPANY", terms: ["PlanetScale"], exclusions: [], priority: 60, estimatedCost: 1, active: true },
  { id: "experimental-junior-signals", revision: "1", family: "EXPERIMENTAL", terms: ["junior", "entry level", "associate"], exclusions: [], priority: 10, estimatedCost: 1, active: true },
];
