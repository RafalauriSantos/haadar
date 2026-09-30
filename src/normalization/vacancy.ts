import { idempotencyKey } from "../domain/ids";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function htmlToBoundedText(value: string, maxLength = 4_000): string {
  const text = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return normalizeWhitespace(text).slice(0, maxLength);
}

export function explicitWorkModel(...values: Array<string | undefined>): "remote" | "hybrid" | "onsite" | "unknown" {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (/\bremote\b/.test(text)) return "remote";
  if (/\bon[ -]?site\b|\bin office\b/.test(text)) return "onsite";
  return "unknown";
}

export async function vacancyFingerprint(input: {
  organization: string;
  title: string;
  location?: string;
  description?: string;
}): Promise<string> {
  return idempotencyKey([
    "vacancy-fingerprint-v1",
    normalizeWhitespace(input.organization).toLowerCase(),
    normalizeWhitespace(input.title).toLowerCase(),
    normalizeWhitespace(input.location ?? "").toLowerCase(),
    normalizeWhitespace(input.description ?? "").toLowerCase(),
  ]);
}
