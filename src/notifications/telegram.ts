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

function sourceLabel(source: string | null | undefined): string {
  if (source?.startsWith("greenhouse:")) return "Greenhouse";
  return bounded(source, 120);
}

export function formatTelegramAlert(card: TelegramAlertCard): string {
  const heading = card.stage === "provisional" ? "🔔 Nova vaga — sinal inicial" : "🔔 Nova vaga encontrada";
  const text = [heading, `💼 ${bounded(card.title, 500)}`, `🏢 Empresa: ${bounded(card.organization, 250)}`,
    `📍 Local: ${bounded(card.location, 250)}`, `🔎 Fonte: ${sourceLabel(card.source)}`, `🔗 ${card.url.slice(0, 1_500)}`,
    "🤖 Enviado por Haadar"].join("\n");
  return text.slice(0, 4_096);
}

export function createTelegramClient(token: string, destination: string, fetcher: typeof fetch = fetch): TelegramClient {
  return {
    async send(text) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: destination, text, disable_web_page_preview: true }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as { ok?: boolean; result?: { message_id?: number }; parameters?: { retry_after?: number } } | null;
        if (response.status === 429) return { kind: "retryable" as const, retryAfterSeconds: payload?.parameters?.retry_after };
        if (!response.ok || !payload?.ok || !payload.result?.message_id) return { kind: response.status >= 500 ? "retryable" as const : "failed" as const };
        return { kind: "sent" as const, messageId: String(payload.result.message_id) };
      } catch {
        return { kind: "unknown" as const };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
