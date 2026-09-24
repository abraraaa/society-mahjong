/**
 * What a player reads when something they tried didn't work. The server
 * explains itself to other programs ('stale version', 'lost the race'); a
 * player gets what happened and what to do next, and never the server's own
 * words. Client-safe: no server imports, so every page can use it.
 */

const MOVED_ON = "That didn't go through. The table had moved on, so try again.";
const TOO_LATE = 'Too late for that one. The table had already moved on.';
const NOT_ALLOWED = "That move isn't open to you right now. Have another look at your tiles.";
const UNDER_WAY = "This game's already under way. You'll get a seat when the next one starts.";
const NO_TABLE = "There's no table with that code. Check it with whoever sent you the link.";
const NOT_SEATED = "You're not seated at this table. Ask the host for the link.";
const FULL = "This table's full.";
const CLOSED = 'This table has closed. Ask the host for a new link.';
const NO_GAME = "We can't find that game. Check the link with whoever sent it.";
const GAME_OVER = "This game's finished. Head back to the room for the next one.";
const BOT_SEAT = "A bot's playing your seat for the rest of this game. You can sit back down when the next one starts.";
const HOST_ONLY = 'Only the host can start the game.';
const IN_PROGRESS = "There's already a game going at this table.";
const SEATS_CHANGED = 'Someone sat down or got up just then. Check the seats and start again.';
const LEAVE_FROM_TABLE = "The game's started, so leave from the table instead.";
const SIGNED_OUT = "We've lost track of who you are. Reload the page to sit back down.";
const CAPTCHA = "We couldn't run the quick security check. Try again, or switch between Wi-Fi and mobile data.";
const OFFLINE = "We couldn't reach the table. Check your connection and try again.";
const SLOW = "The table's taking too long to answer. Give it a moment, then try again if nothing's changed.";
const NO_SETUP = "We couldn't set up that table. Head back to the start and host again.";
const FALLBACK = 'Something went wrong. Try again.';

/**
 * Every refusal a player can meet, by the server's message: the room and game
 * routes (lib/live and app/api), and the engine's rules (IllegalAction), which
 * reach the table as 400s.
 */
const BY_MESSAGE = new Map<string, string>(
  Object.entries({
    // Two taps against the same table: the other one landed first.
    'stale version': MOVED_ON,
    'lost the race': MOVED_ON,
    'that seat was just taken; try again': MOVED_ON,
    'the table changed under you; try again': MOVED_ON,
    // The moment passed before the tap arrived.
    'not your turn': TOO_LATE,
    'no discard to claim': TOO_LATE,
    'no claims pending': TOO_LATE,
    'already responded': TOO_LATE,
    'already exchanged': TOO_LATE,
    'not in preplay': TOO_LATE,
    'nothing drawn': TOO_LATE,
    'nothing to resolve': TOO_LATE,
    'hand is finished': TOO_LATE,
    'hand not finished': TOO_LATE,
    // A move the rules don't allow from this hand.
    'illegal claim': NOT_ALLOWED,
    'tile not in hand': NOT_ALLOWED,
    'not a winning hand': NOT_ALLOWED,
    'cannot claim your own discard': NOT_ALLOWED,
    'no kong available': NOT_ALLOWED,
    'no exchange step': NOT_ALLOWED,
    'action is not for your seat': NOT_ALLOWED,
    'an action is required': NOT_ALLOWED,
    'that is not a move a player can make': NOT_ALLOWED,
    'only the table makes that move': NOT_ALLOWED,
    'that seat is a bot': BOT_SEAT,
    // Rooms.
    'this table has already started': UNDER_WAY,
    'no room with that code': NO_TABLE,
    'this table is full': FULL,
    'this table has closed': CLOSED,
    'not at this table': NOT_SEATED,
    'not seated at this table': NOT_SEATED,
    'only the host can start': HOST_ONLY,
    'a game is in progress': IN_PROGRESS,
    'the seats changed; start again': SEATS_CHANGED,
    'the table has started; leave it from the game': LEAVE_FROM_TABLE,
    // Room set-up the app never sends: only a hand-made request meets these.
    'rooms play karachi rules': NO_SETUP,
    'that is not a room request': NO_SETUP,
    'those room options are not ones we know': NO_SETUP,
    // Games.
    'no such game': NO_GAME,
    'no such room': NO_GAME,
    'game has no live state': NO_GAME,
    'game is over': GAME_OVER,
    'sign in first': SIGNED_OUT,
    'something went wrong': FALLBACK,
  }),
);

/** The browsers' words for a request that never got an answer (Chrome, Safari, Firefox, Node). */
const UNREACHABLE = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;
/** A request the page stopped waiting for: lib/live/client.ts's own 'timed out', or a browser's timeout signal ('signal timed out', 'The operation timed out.'). */
const TIMED_OUT = /timed out/i;

/**
 * Player copy for anything a page caught: an API error (its HTTP status and
 * the server's message), a failed sign-in, or the captcha's own rejection
 * (hCaptcha rejects with a bare string). A value with no status never got an
 * HTTP answer.
 */
export function plainError(err: unknown): string {
  const status = typeof (err as { status?: unknown } | null)?.status === 'number' ? (err as { status: number }).status : 0;
  const raw = typeof err === 'string' ? err : typeof (err as { message?: unknown } | null)?.message === 'string' ? (err as { message: string }).message : '';
  const message = raw.trim().toLowerCase();

  const known = BY_MESSAGE.get(message);
  if (known) return known;
  if (/^exchange exactly \d+ tiles?$/.test(message)) return NOT_ALLOWED;
  // The script didn't load, its call home failed, or the sign-in turned the token down.
  if (message.includes('captcha') || message === 'network-error') return CAPTCHA;
  if (status === 0 && UNREACHABLE.test(message)) return OFFLINE;
  if (status === 0 && TIMED_OUT.test(message)) return SLOW;
  if (status === 410) return CLOSED;
  if (status === 401) return SIGNED_OUT;
  return FALLBACK;
}
