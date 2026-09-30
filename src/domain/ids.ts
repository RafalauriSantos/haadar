export function roundSlotFor(scheduledAt: Date): string {
  const instant = scheduledAt.getTime();
  if (!Number.isFinite(instant)) throw new RangeError("scheduledAt must be a valid date");
  const slotMs = 90 * 60 * 1_000;
  return new Date(Math.floor(instant / slotMs) * slotMs).toISOString();
}

export async function idempotencyKey(parts: string[]): Promise<string> {
  const input = `haadar-key-v1:${JSON.stringify(parts)}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
