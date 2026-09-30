import { recordOperationalEvent, type D1DatabaseLike, type OperationalEvent } from "../storage/d1";

export async function recordEvent(db: D1DatabaseLike, event: OperationalEvent): Promise<void> {
  await recordOperationalEvent(db, event);
}
