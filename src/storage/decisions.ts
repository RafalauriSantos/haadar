import type { GateResult } from "../decision/deterministic-gate";
import type { HeuristicScore } from "../decision/heuristic-score";
import type { FinalDecision } from "../decision/final-decision";

const ALERTS_PER_ROUND = 5;

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
    await db.prepare(
      `INSERT INTO alert_round_admissions
        (round_id, vacancy_id, channel, destination_key, intent_key, created_at)
       SELECT ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM alert_intents WHERE vacancy_id = ? AND channel = ? AND destination_key = ?
       )
       AND (SELECT COUNT(*) FROM alert_round_admissions WHERE round_id = ?) < ?
       ON CONFLICT(round_id, vacancy_id, channel, destination_key) DO NOTHING`,
    ).bind(
      input.roundId, input.vacancyId, input.channel, input.destinationKey, input.earlySignalKey, input.now,
      input.vacancyId, input.channel, input.destinationKey, input.roundId, ALERTS_PER_ROUND,
    ).run();
  }

  await db.prepare(
    `INSERT INTO alert_intents
      (idempotency_key, vacancy_id, decision_id, channel, destination_key, stage,
       status, payload_json, early_signal_key, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ? IS NULL OR EXISTS (
       SELECT 1 FROM alert_round_admissions
       WHERE round_id = ? AND vacancy_id = ? AND channel = ? AND destination_key = ?
     )
     ON CONFLICT(vacancy_id, channel, destination_key) DO UPDATE SET
       decision_id = excluded.decision_id,
       stage = excluded.stage,
       status = CASE
         WHEN alert_intents.status IN ('sent', 'failed') THEN alert_intents.status
         ELSE excluded.status
       END,
       payload_json = excluded.payload_json,
       early_signal_key = coalesce(alert_intents.early_signal_key, excluded.early_signal_key),
       updated_at = excluded.updated_at`,
  ).bind(
    input.earlySignalKey, input.vacancyId, input.decisionId, input.channel, input.destinationKey,
    input.decision.outcome === "alert" ? "final" : "provisional",
    input.decision.outcome === "alert" ? "pending" : "cancelled",
    JSON.stringify(input.payload), input.earlySignalKey, input.now, input.now,
    input.roundId ?? null, input.roundId ?? "", input.vacancyId, input.channel, input.destinationKey,
  ).run();
}
