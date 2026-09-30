export interface DiscoveryMetric {
  sourceId: string;
  queryId: string;
  rawOccurrences: number;
  uniqueVacancies: number;
  exclusiveVacancies: number;
  eligible: number;
  earlySignals: number;
  alertsConfirmed: number;
}

export async function getDiscoveryMetrics(db: D1Database, since: string): Promise<DiscoveryMetric[]> {
  const rows = await db.prepare(
    `SELECT vo.source_id AS sourceId, vo.query_id AS queryId,
       COUNT(*) AS rawOccurrences,
       COUNT(DISTINCT vo.vacancy_id) AS uniqueVacancies,
       SUM(CASE WHEN (SELECT COUNT(DISTINCT query_id) FROM vacancy_occurrences other_vo
                      WHERE other_vo.vacancy_id = vo.vacancy_id) = 1 THEN 1 ELSE 0 END) AS exclusiveVacancies,
       COUNT(DISTINCT CASE WHEN dr.gate_eligible = 1 THEN dr.vacancy_id END) AS eligible,
       COUNT(DISTINCT CASE WHEN dr.early_signal_key IS NOT NULL THEN dr.vacancy_id END) AS earlySignals,
       COUNT(DISTINCT CASE WHEN ai.status = 'sent' THEN ai.vacancy_id END) AS alertsConfirmed
     FROM vacancy_occurrences vo
     LEFT JOIN decision_records dr ON dr.vacancy_id = vo.vacancy_id AND dr.query_id = vo.query_id
     LEFT JOIN alert_intents ai ON ai.vacancy_id = vo.vacancy_id
     WHERE vo.observed_at >= ? AND vo.origin_kind = 'real'
     GROUP BY vo.source_id, vo.query_id
     ORDER BY vo.source_id, vo.query_id`,
  ).bind(since).all<DiscoveryMetric>();
  return rows.results.map((row) => ({
    ...row,
    rawOccurrences: Number(row.rawOccurrences), uniqueVacancies: Number(row.uniqueVacancies), exclusiveVacancies: Number(row.exclusiveVacancies),
    eligible: Number(row.eligible), earlySignals: Number(row.earlySignals), alertsConfirmed: Number(row.alertsConfirmed),
  }));
}
