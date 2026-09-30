export interface TelegramAlertCard {
  title: string;
  organization?: string | null;
  location?: string | null;
  source?: string | null;
  url: string;
  stage: "provisional" | "final";
}

export interface TelegramClient {
  send(text: string): Promise<{ kind: "sent"; messageId: string } | { kind: "retryable"; retryAfterSeconds?: number } | { kind: "failed" } | { kind: "unknown" }>;
  edit?(messageId: string, text: string): Promise<{ kind: "sent" } | { kind: "retryable"; retryAfterSeconds?: number } | { kind: "failed" }>;
}

function bounded(value: string | null | undefined, limit: number): string {
  return (value ?? "não informado").replace(/[\r\n]+/g, " ").trim().slice(0, limit);
}

export function formatTelegramAlert(card: TelegramAlertCard): string {
  const stage = card.stage === "provisional" ? "Sinal inicial" : "Decisão final";
  const text = [stage, bounded(card.title, 500), `Empresa: ${bounded(card.organization, 250)}`,
    `Local: ${bounded(card.location, 250)}`, `Fonte: ${bounded(card.source, 120)}`, card.url.slice(0, 1_500)].join("\n");
  return text.slice(0, 4_096);
}

export function createTelegramClient(token: string, destination: string, fetcher: typeof fetch = fetch): TelegramClient {
  return {
    async send(text) {
      try {
        const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: destination, text, disable_web_page_preview: true }),
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; parameters?: { retry_after?: number } } | null;
        if (response.status === 429) return { kind: "retryable" as const, retryAfterSeconds: payload?.parameters?.retry_after };
        if (!response.ok || !payload?.ok || !payload.result?.message_id) return { kind: response.status >= 500 ? "retryable" as const : "failed" as const };
        return { kind: "sent" as const, messageId: String(payload.result.message_id) };
      } catch {
        return { kind: "unknown" as const };
      }
    },
  };
}
