// Excludes 0/O/1/I so a spoken or handwritten code is never ambiguous.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A short, shareable room code — `KHI-4287` style, themed to Karachi. */
export function generateRoomCode(prefix = 'KHI'): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return `${prefix}-${s}`;
}
