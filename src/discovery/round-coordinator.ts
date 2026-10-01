import { idempotencyKey, roundSlotFor } from "../domain/ids";
import type { BudgetState, DiscoveryRound, DiscoveryTask, QueryDefinition } from "../domain/types";
import { claimTaskPublications, persistRoundPlan, recoverStaleTaskPublications } from "../storage/d1";
import { decideBudget, type UsageSnapshot } from "../budget/budget-guard";
import { estimateRoundCost, readUsageSnapshot, reserveRoundBudget, utcDay } from "../budget/reservations";
import { freeFirstConfig } from "../config";

interface QueryPortfolioSnapshot {
  revision: string;
  queries: QueryDefinition[];
}

interface RoundCoordinatorInput {
  db: D1Database;
  scheduledAt: Date;
  roundSlot?: string;
  portfolio: QueryPortfolioSnapshot;
  usage?: UsageSnapshot;
  adapterIds: string[];
  now?: Date;
  publicationLeaseMs?: number;
  publicationStaleMs?: number;
  boardOnceAdapters?: boolean;
  deliveryMode?: "live" | "silent";
}

export interface RoundAdmission {
  round: DiscoveryRound;
  budgetState: BudgetState;
  tasks: DiscoveryTask[];
}

export async function admitRound(input: RoundCoordinatorInput): Promise<RoundAdmission> {
  const slot = input.roundSlot ?? roundSlotFor(input.scheduledAt);
  const now = input.now ?? new Date();
  const usage = input.usage ?? await readUsageSnapshot(input.db, utcDay(now));
  const decision = decideBudget(usage);
  const roundId = await idempotencyKey(["round", slot]);
  const round: DiscoveryRound = {
    id: roundId,
    slot: { key: slot, scheduledAt: input.scheduledAt.toISOString() },
    portfolioRevision: input.portfolio.revision,
    budgetState: decision.state,
    status: decision.admitEssential ? "planned" : "deferred"
  };

  const admittedQueries = decision.admitEssential ? input.portfolio.queries.filter((query) => {
    if (!query.active || (query.cooldownUntil && query.cooldownUntil > input.scheduledAt.toISOString())) return false;
    if (query.family === "EXPERIMENTAL" && !decision.admitOptional) return false;
    return true;
  }).sort((left, right) => right.priority - left.priority) : [];
  const tasks: DiscoveryTask[] = [];
  const tasksPerSource = new Map<string, number>();
  if (input.boardOnceAdapters && decision.admitEssential) {
    for (const adapterId of input.adapterIds) {
      const taskKey = await idempotencyKey(["task", roundId, "board-once", adapterId]);
      tasks.push({ id: taskKey, roundId, queryId: `board:${adapterId}`, adapterId, idempotencyKey: taskKey, attempt: 0, deliveryMode: input.deliveryMode ?? "live" });
    }
  }
  for (const query of input.boardOnceAdapters ? [] : admittedQueries) {
    for (const adapterId of input.adapterIds) {
      if ((tasksPerSource.get(adapterId) ?? 0) >= freeFirstConfig.maxTasksPerSource) continue;
      const taskKey = await idempotencyKey(["task", roundId, query.id, adapterId]);
      const task: DiscoveryTask = {
        id: taskKey,
        roundId,
        queryId: query.id,
        adapterId,
        idempotencyKey: taskKey,
        attempt: 0,
        deliveryMode: input.deliveryMode ?? "live",
      };
      tasks.push(task);
      tasksPerSource.set(adapterId, (tasksPerSource.get(adapterId) ?? 0) + 1);
      if (tasks.length >= freeFirstConfig.maxTasksPerRound) break;
    }
    if (tasks.length >= freeFirstConfig.maxTasksPerRound) break;
  }
  const reservation = decision.admitEssential
    ? await reserveRoundBudget(input.db, {
        roundId,
        day: utcDay(now),
        cost: estimateRoundCost(tasks.length, decision.admitEnrichment),
        now: now.toISOString(),
        reason: `round:${decision.state.toLowerCase()}`,
      })
    : { admitted: false, usage };
  if (!reservation.admitted) {
    round.status = "deferred";
    round.budgetState = "EMERGENCY";
    tasks.length = 0;
  }
  const snapshotHash = await idempotencyKey(["portfolio-snapshot", JSON.stringify(input.portfolio)]);
  const persisted = await persistRoundPlan(input.db, {
    round,
    portfolio: input.portfolio,
    snapshotHash,
    tasks,
    now: now.toISOString(),
  });
  await recoverStaleTaskPublications(input.db, {
    roundId: persisted.round.id,
    staleBefore: new Date(now.getTime() - (input.publicationStaleMs ?? 5 * 24 * 60 * 60_000)).toISOString(),
    now: now.toISOString(),
  });
  const leaseToken = crypto.randomUUID();
  const claimedTasks = await claimTaskPublications(input.db, {
    roundId: persisted.round.id,
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + (input.publicationLeaseMs ?? 5 * 60_000)).toISOString(),
    leaseToken,
  });
  return {
    round: persisted.round,
    budgetState: persisted.round.budgetState,
    tasks: claimedTasks,
  };
}
