export type QueryFamily = "BROAD" | "ROLE" | "STACK" | "CONTEXT" | "COMPANY" | "EXPERIMENTAL";

export type BudgetState = "NORMAL" | "CONSERVATIVE" | "ESSENTIAL" | "EMERGENCY";

export interface RoundSlot {
  key: string;
  scheduledAt: string;
}

export interface DiscoveryRound {
  id: string;
  slot: RoundSlot;
  portfolioRevision: string;
  budgetState: BudgetState;
  status: "planned" | "running" | "completed" | "partial" | "deferred";
}

export interface DiscoveryTask {
  id: string;
  roundId: string;
  queryId: string;
  adapterId: string;
  idempotencyKey: string;
  attempt: number;
}

export interface QueryDefinition {
  id: string;
  revision: string;
  family: QueryFamily;
  terms: string[];
  exclusions: string[];
  priority: number;
  estimatedCost: number;
  active: boolean;
  cooldownUntil?: string;
}

export interface NormalizedObservation {
  sourceId: string;
  sourceVacancyId?: string;
  canonicalUrl: string;
  title: string;
  organization?: string;
  location?: string;
  workModel?: "remote" | "hybrid" | "onsite" | "unknown";
  descriptionSummary?: string;
  publishedAt?: string;
  observedAt: string;
  queryId: string;
  fingerprint: string;
}
