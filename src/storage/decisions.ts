import type { GateResult } from "../decision/deterministic-gate";
import type { HeuristicScore } from "../decision/heuristic-score";
import type { FinalDecision } from "../decision/final-decision";

export async function persistDecisionAndIntent(
  db: D1Database,
  input: {
    decisionId: string;
    vacancyId: string;
    queryId: string;
    gate: GateResult;
    score: HeuristicScore;
    decision: FinalDecision;
    earlySignalKey?: string;
    roundId?: string;
    channel: string;
    destinationKey: string;
    payload: Record<string, unknown>;
    now: string;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO decision_records
      (id, vacancy_id, query_id, gate_rule_version, gate_eligible, gate_reason,
       score_rule_version, score, score_features_json, outcome, decision_rule_version,
       decision_reason, early_signal_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).bind(
    input.decisionId, input.vacancyId, input.queryId, input.gate.ruleVersion,
    input.gate.eligible ? 1 : 0, input.gate.reasonCode, input.score.ruleVersion,
    input.score.value, JSON.stringify(input.score.features), input.decision.outcome,
    input.decision.ruleVersion, input.decision.reasonCode, input.earlySignalKey ?? null, input.now,
  ).run();

  if (!input.earlySignalKey) return;
  if (input.roundId) {
    const reservation = await db.prepare(
      `INSERT INTO alert_round_budget (round_id, admitted_count, limit_count, updated_at)
       VALUES (?, 1, 5, ?)
       ON CONFLICT(round_id) DO UPDATE SET
         admitted_count = admitted_count + 1, updated_at = excluded.updated_at
       WHERE alert_round_budget.admitted_count < alert_round_budget.limit_count
       RETURNING admitted_count`,
    ).bind(input.roundId, input.now).first<{ admitted_count: number }>();
    if (!reservation) return;
  }

  await db.prepare(
    `INSERT INTO alert_intents
      (idempotency_key, vacancy_id, decision_id, channel, destination_key, stage,
       status, payload_json, early_signal_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(vacancy_id, channel, destination_key) DO UPDATE SET
       decision_id = excluded.decision_id,
       stage = excluded.stage,
       status = excluded.status,
       payload_json = excluded.payload_json,
       early_signal_key = coalesce(alert_intents.early_signal_key, excluded.early_signal_key),
       updated_at = excluded.updated_at`,
  ).bind(
    input.earlySignalKey, input.vacancyId, input.decisionId, input.channel, input.destinationKey,
    input.decision.outcome === "alert" ? "final" : "provisional",
    input.decision.outcome === "alert" ? "pending" : "cancelled",
    JSON.stringify(input.payload), input.earlySignalKey, input.now, input.now,
  ).run();
}
