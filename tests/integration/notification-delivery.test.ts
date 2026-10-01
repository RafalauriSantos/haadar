import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { dispatchOne } from "../../src/notifications/dispatcher";
import { createTelegramClient, formatTelegramAlert, type TelegramClient } from "../../src/notifications/telegram";

const now = new Date("2026-10-07T12:00:00.000Z");

async function insertIntent(id: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO vacancies
        (id, canonical_url, title, work_model, fingerprint, fingerprint_version, first_observed_at, last_observed_at, created_at, updated_at)
       VALUES (?, ?, 'Backend Developer', 'remote', ?, 'v1', ?, ?, ?, ?)`,
    ).bind(`vacancy-${id}`, `https://jobs.example/${id}`, `fingerprint-${id}`, now.toISOString(), now.toISOString(), now.toISOString(), now.toISOString()),
    env.DB.prepare(
      `INSERT INTO decision_records
        (id, vacancy_id, query_id, gate_rule_version, gate_eligible, gate_reason, score_rule_version, score, score_features_json, outcome, decision_rule_version, decision_reason, created_at)
       VALUES (?, ?, 'role-backend', 'v1', 1, 'eligible', 'v1', 0.8, '{}', 'alert', 'v1', 'match', ?)`,
    ).bind(`decision-${id}`, `vacancy-${id}`, now.toISOString()),
    env.DB.prepare(
      `INSERT INTO alert_intents
        (idempotency_key, vacancy_id, decision_id, channel, destination_key, stage, status, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, 'telegram', 'private-destination', 'final', 'pending', ?, ?, ?)`,
    ).bind(id, `vacancy-${id}`, `decision-${id}`, JSON.stringify({ title: "Backend Developer", organization: "Acme", location: "Remote", source: "Greenhouse", url: `https://jobs.example/${id}` }), now.toISOString(), now.toISOString()),
  ]);
}

describe("recoverable notification dispatch", () => {
  it("persists provider success and never sends the same confirmed intent again", async () => {
    await insertIntent("delivery-sent");
    const client: TelegramClient = { send: async () => ({ kind: "sent", messageId: "42" }) };
    await expect(dispatchOne(env.DB, client, now)).resolves.toBe("sent");
    await expect(dispatchOne(env.DB, client, now)).resolves.toBe("none");
    expect(await env.DB.prepare("SELECT state, provider_message_id FROM notification_deliveries WHERE intent_key = 'delivery-sent'").first()).toMatchObject({ state: "sent", provider_message_id: "42" });
  });

  it("keeps timeout ambiguity visible instead of resending blindly", async () => {
    await insertIntent("delivery-unknown");
    const client: TelegramClient = { send: async () => ({ kind: "unknown" }) };
    await expect(dispatchOne(env.DB, client, now)).resolves.toBe("unknown");
    expect(await env.DB.prepare("SELECT state FROM notification_deliveries WHERE intent_key = 'delivery-unknown'").first()).toMatchObject({ state: "unknown" });
  });

  it("sends an alert stored with the canonical vacancy URL", async () => {
    await insertIntent("delivery-canonical-url");
    await env.DB.prepare(
      "UPDATE alert_intents SET payload_json = ? WHERE idempotency_key = 'delivery-canonical-url'",
    ).bind(JSON.stringify({
      title: "Backend Developer",
      organization: "Acme",
      location: "Remote",
      canonicalUrl: "https://jobs.example/canonical-url",
      stage: "final",
    })).run();
    const client: TelegramClient = { send: async () => ({ kind: "sent", messageId: "44" }) };
    await expect(dispatchOne(env.DB, client, now)).resolves.toBe("sent");
    expect(await env.DB.prepare("SELECT state FROM notification_deliveries WHERE intent_key = 'delivery-canonical-url'").first())
      .toMatchObject({ state: "sent" });
  });

  it("marks an expired sending lease as unknown before considering another intent", async () => {
    await insertIntent("delivery-expired");
    await env.DB.prepare(
      `INSERT INTO notification_deliveries
        (intent_key, state, lease_token, lease_expires_at, attempts, created_at, updated_at)
       VALUES ('delivery-expired', 'sending', 'expired-lease', '2026-10-07T11:59:00.000Z', 1, ?, ?)`,
    ).bind(now.toISOString(), now.toISOString()).run();
    const client: TelegramClient = { send: async () => ({ kind: "sent", messageId: "43" }) };
    await dispatchOne(env.DB, client, now);
    expect(await env.DB.prepare("SELECT state, last_error_kind FROM notification_deliveries WHERE intent_key = 'delivery-expired'").first())
      .toMatchObject({ state: "unknown", last_error_kind: "delivery_lease_expired" });
  });

  it("formats a compact card with source and Haadar identity", () => {
    const card = formatTelegramAlert({ title: "*Backend*\nDeveloper", organization: "Acme", location: "Remote", source: "Greenhouse", url: "https://jobs.example/1", stage: "provisional" });
    expect(card).toContain("🔔 Nova vaga — sinal inicial");
    expect(card).toContain("💼 *Backend* Developer");
    expect(card).toContain("🏢 Empresa: Acme");
    expect(card).toContain("📍 Local: Remote");
    expect(card).toContain("🔎 Fonte: Greenhouse");
    expect(card).toContain("🤖 Enviado por Haadar");
    expect(card).not.toContain("\nDeveloper");
    expect(card.length).toBeLessThanOrEqual(4096);
  });

  it("maps provider throttling, rejection and transport ambiguity without exposing credentials", async () => {
    const throttled = createTelegramClient("private-token", "private-chat", async () => new Response(JSON.stringify({ parameters: { retry_after: 47 } }), { status: 429 }));
    await expect(throttled.send("card")).resolves.toEqual({ kind: "retryable", retryAfterSeconds: 47 });
    const rejected = createTelegramClient("private-token", "private-chat", async () => new Response("{}", { status: 403 }));
    await expect(rejected.send("card")).resolves.toEqual({ kind: "failed" });
    const timeout = createTelegramClient("private-token", "private-chat", async () => { throw new Error("timeout"); });
    await expect(timeout.send("card")).resolves.toEqual({ kind: "unknown" });
  });
});
