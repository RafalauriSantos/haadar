export function roundSlotFor(scheduledAt: Date): string {
  const iso = scheduledAt.toISOString();
  return `${iso.slice(0, 16)}Z`;
}

export async function idempotencyKey(parts: string[]): Promise<string> {
  const input = parts.join("\u001f");
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
