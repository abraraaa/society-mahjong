import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/** Whether `given` is the configured secret, compared in constant time over fixed-length digests; false when either is missing. */
export function secretMatches(given: string | null | undefined, secret: string | undefined): boolean {
  if (!given || !secret) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}
