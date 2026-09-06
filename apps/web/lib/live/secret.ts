import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/** Whether `given` is the configured secret, compared in constant time; false when either is missing. */
export function secretMatches(given: string | null | undefined, secret: string | undefined): boolean {
  if (!given || !secret) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
