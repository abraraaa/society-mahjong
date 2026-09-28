/**
 * What a player reads when something they tried didn't work. The server
 * explains itself to other programs ('stale version', 'lost the race'); a
 * player gets what happened and what to do next, and never the server's own
 * words. Client-safe: no server imports, so every page can use it.
 */

const MOVED_ON = 'The table moved on before that got there. Have a look, and go again if you still can.';
const TOO_LATE = 'Too late for that one. The table had already moved on.';
const NOT_ALLOWED = "That move isn't open to you right now. Have another look at your tiles.";
const UNDER_WAY = "All four seats are taken in this game. When it's over, open the invite link again and you can play the next one.";
const NO_TABLE = "There's no table with that code. Check it with whoever sent you the link.";
const NOT_SEATED = "You're not in this game. Open the invite link again: if a bot's playing a seat, you can take over from it.";
const FULL = 'All four seats are taken. If someone gets up, try again, or host a table of your own.';
const SEAT_TAKEN = 'Someone took that seat just as you did. Try again for another.';
const NOT_FREE = "That seat isn't free. Open the invite link again to see where you can sit.";
const CLOSED = "This table's been quiet for a while, so it's closed to new players. Ask someone who plays at this table to open the link, then try again.";
const NO_GAME = "We can't find that game. Check the link with whoever sent it.";
const GAME_OVER = "This game's finished. Head back to the room for the next one.";
const BOT_SEAT = "A bot's playing your seat now. Open the invite link again to sit back down.";
const HOST_ONLY = 'Only the host can start the game. Give them a nudge.';
const HOST_ENDS = "Only the host can end the game. Ask them if everyone's had enough.";
const HOST_HANDS_OVER = "Only the host can let a bot play for someone. Ask them if a friend's stepped away.";
const SOMEONE_ELSE = 'You can only let a bot play for someone else. Tap their name at the top of the table.';
const BOT_ALREADY = "A bot's already playing that seat, so there's nothing to do.";
const JUST_PLAYED = "They've just played, so they're still at the table.";
const IN_PROGRESS = "There's already a game going at this table.";
const SEATS_CHANGED = 'Someone sat down or got up just then. Check the seats and start again.';
const LEAVE_FROM_TABLE = "The game's started, so leave from the table instead.";
const SIGNED_OUT = "We've lost track of who you are on this phone. Try again, or open the invite link again.";
const CAPTCHA = "We couldn't run the quick security check. Try again, or switch between Wi-Fi and mobile data.";
const CHECK_CLOSED = 'The security check closed before it finished. Tap Sit down to have another go.';
const OFFLINE = "We couldn't reach the table. Check your connection and try again.";
const SLOW = "The table's taking too long to answer. Give it a moment, then try again if nothing's changed.";
const NO_SETUP = "We couldn't set up that table. Head back to the start and host again.";
const FALLBACK = 'Something went wrong at our end. Give it another go.';

/**
 * Every refusal a player can meet, by the server's message: the room and game
 * routes (lib/live and app/api), and the engine's rules (IllegalAction), which
 * reach the table as 400s. Also hCaptcha's own codes for a puzzle the guest
 * didn't finish.
 */
const BY_MESSAGE = new Map<string, string>(
  Object.entries({
    // Two taps against the same table: the other one landed first.
    'stale version': MOVED_ON,
    'lost the race': MOVED_ON,
    'the table changed under you; try again': MOVED_ON,
    'that seat was just taken; try again': SEAT_TAKEN,
    'that seat is taken': SEAT_TAKEN,
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
    // Taking a bot's seat over from the take-over screen, when the offer has gone.
    'that seat is kept for someone': NOT_FREE,
    'that is not a seat to sit in': NOT_FREE,
    // Room set-up the app never sends: only a hand-made request meets these.
    'rooms play karachi rules': NO_SETUP,
    'that is not a room request': NO_SETUP,
    'those room options are not ones we know': NO_SETUP,
    // Games.
    'no such game': NO_GAME,
    'no such room': NO_GAME,
    'game has no live state': NO_GAME,
    'game is over': GAME_OVER,
    'only the host can end the game': HOST_ENDS,
    'only the host can hand a seat to a bot': HOST_HANDS_OVER,
    'that is your own seat': SOMEONE_ELSE,
    'that is not a seat': SOMEONE_ELSE,
    'a bot already plays that seat': BOT_ALREADY,
    'that player has just played': JUST_PLAYED,
    'sign in first': SIGNED_OUT,
    'something went wrong': FALLBACK,
    // hCaptcha: the guest closed the puzzle, or left it until it lapsed.
    'challenge-closed': CHECK_CLOSED,
    'challenge-expired': CHECK_CLOSED,
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

/**
 * The retry button's words when joining a table failed. A game under way or
 * a full table won't have changed a moment later, so the button offers to
 * check again rather than promising another go will work. A seat lost in the
 * same instant as someone else's is the one conflict worth another go at once,
 * and its line says so.
 */
export function joinRetryLabel(err: unknown): string {
  const status = typeof (err as { status?: unknown } | null)?.status === 'number' ? (err as { status: number }).status : 0;
  return status === 409 && plainError(err) !== SEAT_TAKEN ? 'Check again' : 'Try again';
}
