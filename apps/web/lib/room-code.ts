// Excludes 0/O/1/I so a spoken or handwritten code is never ambiguous. Exactly
// 32 symbols, so the top five bits of a random byte pick each one evenly, with
// no modulo and no rejection loop.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 5;

/**
 * A short, shareable room code — `KHI-4287Q` style, themed to Karachi. Five
 * symbols from thirty-two is 2^25 codes, drawn from the platform's CSPRNG: a
 * code is enough to sit down, so it must not be guessable from the last one.
 */
export function generateRoomCode(prefix = 'KHI'): string {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(LENGTH))) s += ALPHABET[b >>> 3];
  return `${prefix}-${s}`;
}

/**
 * A code this app could have issued: KHI-, then four (older rooms) or five
 * symbols from the alphabet. Link cards check it so a made-up path cannot
 * mint a branded invite that reads "Table FREE-MONEY".
 */
export function isRoomCode(code: string): boolean {
  return /^KHI-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,5}$/.test(code);
}
