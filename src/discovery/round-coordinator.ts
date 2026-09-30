import { idempotencyKey, roundSlotFor } from "../domain/ids";
import type { BudgetState, DiscoveryRound, DiscoveryTask, QueryDefinition } from "../domain/types";
import { createOrGetRound, createTaskIfAbsent } from "../storage/d1";
import { decideBudget, type UsageSnapshot } from "../budget/budget-guard";

interface QueryPortfolioSnapshot {
  revision: string;
  queries: QueryDefinition[];
}

interface RoundCoordinatorInput {
  db: Parameters<typeof createOrGetRound>[0];
  scheduledAt: Date;
  portfolio: QueryPortfolioSnapshot;
  usage: UsageSnapshot;
  adapterIds: string[];
}

export interface RoundAdmission {
  round: DiscoveryRound;
  budgetState: BudgetState;
  tasks: DiscoveryTask[];
}

export async function admitRound(input: RoundCoordinatorInput): Promise<RoundAdmission> {
  const slot = roundSlotFor(input.scheduledAt);
  const decision = decideBudget(input.usage);
  const roundId = await idempotencyKey(["round", slot]);
  const round: DiscoveryRound = {
    id: roundId,
    slot: { key: slot, scheduledAt: input.scheduledAt.toISOString() },
    portfolioRevision: input.portfolio.revision,
    budgetState: decision.state,
    status: decision.admitEssential ? "planned" : "deferred"
  };
  await createOrGetRound(input.db, round);

  if (!decision.admitEssential) return { round, budgetState: decision.state, tasks: [] };

  const admittedQueries = input.portfolio.queries.filter((query) => {
    if (!query.active || (query.cooldownUntil && query.cooldownUntil > input.scheduledAt.toISOString())) return false;
    if (query.family === "EXPERIMENTAL" && !decision.admitOptional) return false;
    return true;
  });
  const tasks: DiscoveryTask[] = [];
  for (const query of admittedQueries) {
    for (const adapterId of input.adapterIds) {
      const taskKey = await idempotencyKey(["task", roundId, query.id, adapterId]);
      const task: DiscoveryTask = {
        id: taskKey,
        roundId,
        queryId: query.id,
        adapterId,
        idempotencyKey: taskKey,
        attempt: 0
      };
      await createTaskIfAbsent(input.db, task);
      tasks.push(task);
    }
  }
  return { round, budgetState: decision.state, tasks };
}
