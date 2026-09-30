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
    channel: string;
    destinationKey: string;
    payload: Record<string, unknown>;
    now: string;
  },
): Promise<void> {
  const intentKey = input.earlySignalKey ?? `discard:${input.decisionId}`;
  await db.batch([
    db.prepare(
      `INSERT INTO decision_records
        (id, vacancy_id, query_id, gate_rule_version, gate_eligible, gate_reason,
         score_rule_version, score, score_features_json, outcome, decision_rule_version,
         decision_reason, early_signal_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      input.decisionId,
      input.vacancyId,
      input.queryId,
      input.gate.ruleVersion,
      input.gate.eligible ? 1 : 0,
      input.gate.reasonCode,
      input.score.ruleVersion,
      input.score.value,
      JSON.stringify(input.score.features),
      input.decision.outcome,
      input.decision.ruleVersion,
      input.decision.reasonCode,
      input.earlySignalKey ?? null,
      input.now,
    ),
    db.prepare(
      `INSERT INTO alert_intents
        (idempotency_key, vacancy_id, decision_id, channel, destination_key, stage,
         status, payload_json, early_signal_key, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ? = 1
       ON CONFLICT(vacancy_id, channel, destination_key) DO UPDATE SET
         decision_id = excluded.decision_id,
         stage = excluded.stage,
         status = excluded.status,
         payload_json = excluded.payload_json,
         early_signal_key = coalesce(alert_intents.early_signal_key, excluded.early_signal_key),
         updated_at = excluded.updated_at`,
    ).bind(
      intentKey,
      input.vacancyId,
      input.decisionId,
      input.channel,
      input.destinationKey,
      input.decision.outcome === "alert" ? "final" : "provisional",
      input.decision.outcome === "alert" ? "pending" : "cancelled",
      JSON.stringify(input.payload),
      input.earlySignalKey ?? null,
      input.now,
      input.now,
      input.earlySignalKey ? 1 : 0,
    ),
  ]);
}
