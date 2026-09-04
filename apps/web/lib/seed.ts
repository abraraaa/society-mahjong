/**
 * Mint a deal seed for one visit.
 *
 * Deliberately impure, and deliberately called from the server render of a
 * `force-dynamic` route: the seed has to differ per request (so every visitor
 * gets their own deal) and has to be decided before the HTML is written (so
 * the client hydrates the same deal instead of re-dealing after mount). The
 * random suffix covers two visits landing in the same millisecond.
 */
export function newDealSeed(): string {
  return `solo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A game seed, minted on the server when a host starts a table. It is the one
 * secret in the system: with it, the whole wall is known. It lives in
 * `games.seed`, which no client can read while the game is live.
 */
export function newGameSeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `game-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
