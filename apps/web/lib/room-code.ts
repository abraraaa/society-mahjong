// Excludes 0/O/1/I so a spoken or handwritten code is never ambiguous. Exactly
// 32 symbols, so a random byte modulo the length picks each one evenly.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 5;

/**
 * A short, shareable room code — `KHI-4287Q` style, themed to Karachi. Five
 * symbols from thirty-two is 2^25 codes, drawn from the platform's CSPRNG: a
 * code is enough to sit down, so it must not be guessable from the last one.
 */
export function generateRoomCode(prefix = 'KHI'): string {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(LENGTH))) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${s}`;
}
