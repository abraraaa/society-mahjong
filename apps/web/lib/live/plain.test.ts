import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { joinRetryLabel, plainError } from './plain';
import { parseRoomRequest } from './validate';

const FALLBACK = 'Something went wrong at our end. Give it another go.';
const api = (status: number, message: string) => plainError(new ApiError(status, message));

describe('plainError: the lines the copy calls for', () => {
  it('a tap that lost to another one says the table moved on, without promising the move is still there', () => {
    const line = 'The table moved on before that got there. Have a look, and go again if you still can.';
    expect(api(409, 'stale version')).toBe(line);
    expect(api(409, 'lost the race')).toBe(line);
  });

  it('a game already under way says to come back with the link once it is over', () => {
    expect(api(409, 'this table has already started')).toBe("This game's already under way. When it's over, open this link again and you can take a seat before the next deal.");
  });

  it('a code with no room behind it says to check it', () => {
    expect(api(404, 'no room with that code')).toBe("There's no table with that code. Check it with whoever sent you the link.");
  });

  it('someone not playing is told when the invite link will seat them', () => {
    const line = "You're not playing in this game. When it's over, open the invite link again to take a seat for the next one.";
    expect(api(403, 'not at this table')).toBe(line);
    expect(api(403, 'not seated at this table')).toBe(line);
  });

  it('a full table says what to do about it', () => {
    expect(api(409, 'this table is full')).toBe('All four seats are taken. If someone gets up, try again, or host a table of your own.');
  });

  it('a seat taken in the same instant says to try again for another', () => {
    expect(api(409, 'that seat was just taken; try again')).toBe('Someone took that seat just as you did. Try again for another.');
  });

  it('any 410 is a closed table, whatever the words', () => {
    const line = 'This table has closed. Ask the host for a new link.';
    expect(api(410, 'this table has closed')).toBe(line);
    expect(api(410, 'gone')).toBe(line);
    expect(api(410, '')).toBe(line);
  });

  it('a captcha that could not run offers a retry or another network', () => {
    const line = "We couldn't run the quick security check. Try again, or switch between Wi-Fi and mobile data.";
    expect(plainError(new Error('could not load hCaptcha'))).toBe(line);
    expect(plainError(new Error('hcaptcha did not initialise'))).toBe(line);
    expect(plainError(new Error('captcha gave no token'))).toBe(line);
    // hCaptcha's own rejection is a bare string, not an Error.
    expect(plainError('network-error')).toBe(line);
    // The sign-in turning the token down (an auth error with a status).
    expect(plainError({ status: 400, message: 'captcha protection: request disallowed (invalid-input-response)' })).toBe(line);
  });

  it('a security puzzle closed or left too long is not a fault, and says how to go again', () => {
    const line = 'The security check closed before it finished. Tap Sit down to have another go.';
    expect(plainError('challenge-closed')).toBe(line);
    expect(plainError('challenge-expired')).toBe(line);
  });

  it('anything else is a plain shrug that owns the fault and gives a next step', () => {
    expect(api(500, 'something went wrong')).toBe(FALLBACK);
    expect(api(502, 'Bad Gateway')).toBe(FALLBACK);
    expect(api(504, 'the server answered 504')).toBe(FALLBACK);
    expect(api(418, 'a brand new server message')).toBe(FALLBACK);
    expect(plainError(new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) must be set'))).toBe(FALLBACK);
    expect(plainError(null)).toBe(FALLBACK);
    expect(plainError(undefined)).toBe(FALLBACK);
    expect(plainError(42)).toBe(FALLBACK);
    expect(plainError({})).toBe(FALLBACK);
  });
});

describe('plainError: the rest of what the server can say', () => {
  it('a Leave that crossed another change says the table moved on', () => {
    expect(api(409, 'the table changed under you; try again')).toBe('The table moved on before that got there. Have a look, and go again if you still can.');
  });

  it("the engine's timing refusals say it was too late", () => {
    const line = 'Too late for that one. The table had already moved on.';
    for (const m of [
      'not your turn',
      'no discard to claim',
      'no claims pending',
      'already responded',
      'already exchanged',
      'not in preplay',
      'nothing drawn',
      'nothing to resolve',
      'hand is finished',
      'hand not finished',
    ])
      expect(api(400, m), m).toBe(line);
  });

  it("the engine's rule refusals point back at the tiles", () => {
    const line = "That move isn't open to you right now. Have another look at your tiles.";
    for (const m of [
      'illegal claim',
      'not a winning hand',
      'cannot claim your own discard',
      'no kong available',
      'no exchange step',
      'exchange exactly 3 tiles',
      'action is not for your seat',
    ])
      expect(api(m === 'action is not for your seat' ? 403 : 400, m), m).toBe(line);
  });

  it('a seat a bot has taken says how to sit back in', () => {
    expect(api(403, 'that seat is a bot')).toBe("A bot's playing your seat for the rest of this game. When it's over, open the invite link again to sit back in.");
  });

  it('the host-only and in-progress refusals at the start', () => {
    expect(api(403, 'only the host can start')).toBe('Only the host can start the game.');
    expect(api(409, 'a game is in progress')).toBe("There's already a game going at this table.");
    expect(api(409, 'the seats changed; start again')).toBe('Someone sat down or got up just then. Check the seats and start again.');
    expect(api(409, 'the table has started; leave it from the game')).toBe("The game's started, so leave from the table instead.");
  });

  it('a game that is missing or over', () => {
    const missing = "We can't find that game. Check the link with whoever sent it.";
    expect(api(404, 'no such game')).toBe(missing);
    expect(api(404, 'no such room')).toBe(missing);
    expect(api(404, 'game has no live state')).toBe(missing);
    expect(api(409, 'game is over')).toBe("This game's finished. Head back to the room for the next one.");
  });

  it('a lapsed session says to try again or come back through the link, by message or by any 401', () => {
    const line = "We've lost track of who you are on this phone. Try again, or open the invite link again.";
    expect(api(401, 'sign in first')).toBe(line);
    expect(api(401, 'Unauthorized')).toBe(line);
  });

  it('a request that never got an answer says to check the connection', () => {
    const line = "We couldn't reach the table. Check your connection and try again.";
    expect(plainError(new TypeError('Failed to fetch'))).toBe(line);
    expect(plainError(new TypeError('Load failed'))).toBe(line);
    expect(plainError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(line);
    // Supabase's auth client reports a failed fetch with status 0.
    expect(plainError({ status: 0, message: 'Failed to fetch' })).toBe(line);
  });

  it('a request the page stopped waiting for says the table is slow, and to try again if nothing changed', () => {
    const line = "The table's taking too long to answer. Give it a moment, then try again if nothing's changed.";
    // lib/live/client.ts's own timeout.
    expect(plainError(new ApiError(0, 'timed out'))).toBe(line);
    // A browser's timeout signal: Chrome's and Safari's words.
    expect(plainError(new DOMException('signal timed out', 'TimeoutError'))).toBe(line);
    expect(plainError(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(line);
    // A server that answered, whatever it said, is not a timeout here.
    expect(api(504, 'timed out')).toBe(FALLBACK);
  });

  it('reads the message loosely: case and stray space', () => {
    expect(api(409, '  Stale Version ')).toBe('The table moved on before that got there. Have a look, and go again if you still can.');
  });

  it('an Object.prototype name is not mistaken for a server message', () => {
    expect(api(400, 'constructor')).toBe(FALLBACK);
    expect(api(400, 'toString')).toBe(FALLBACK);
  });

  it('a room request the app would never send still gets a line, not the shrug', () => {
    for (const body of ['x', { rulesetId: 'taiwanese' }, { options: { strict: 1 } }]) {
      const request = parseRoomRequest(body);
      expect(request.ok, JSON.stringify(body)).toBe(false);
      if (!request.ok) expect(api(400, request.error), request.error).not.toBe(FALLBACK);
    }
  });
});

describe('joinRetryLabel', () => {
  it('asks the visitor to check again when the table is under way or full, since an instant retry would meet the same answer', () => {
    expect(joinRetryLabel(new ApiError(409, 'this table has already started'))).toBe('Check again');
    expect(joinRetryLabel(new ApiError(409, 'this table is full'))).toBe('Check again');
  });

  it('keeps Try again for a seat lost in the same instant, where another go at once can work, and for everything else', () => {
    expect(joinRetryLabel(new ApiError(409, 'that seat was just taken; try again'))).toBe('Try again');
    expect(joinRetryLabel(new ApiError(500, 'something went wrong'))).toBe('Try again');
    expect(joinRetryLabel(new ApiError(401, 'sign in first'))).toBe('Try again');
    expect(joinRetryLabel(new TypeError('Failed to fetch'))).toBe('Try again');
    expect(joinRetryLabel('challenge-closed')).toBe('Try again');
    expect(joinRetryLabel(null)).toBe('Try again');
  });
});

/**
 * Every refusal a player can reach, read from the source: HttpError in the
 * server code, the engine's IllegalAction (a 400 at the table), the table's
 * NotYourMove (a 403), and the room request's refusals, which the rooms route
 * passes on as a 400. A new message with no line in plain.ts fails here rather
 * than reaching a player as the shrug.
 */
describe('plainError covers every message the server can send', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const web = join(here, '..', '..');
  const repo = join(web, '..', '..');
  const engine = join(repo, 'packages', 'engine', 'src');

  interface Source {
    readonly path: string;
    readonly text: string;
  }

  function sources(dir: string): Source[] {
    return (readdirSync(dir, { recursive: true }) as string[])
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => ({ path: relative(repo, join(dir, f)), text: readFileSync(join(dir, f), 'utf8') }));
  }

  /** A string literal in any of the three quotes. */
  const LITERAL = String.raw`(?<q>['"\x60])(?<message>(?:\\.|(?!\k<q>)[^\\])+)\k<q>`;
  const HTTP = new RegExp(String.raw`HttpError\(\s*(?<status>\d{3}),\s*${LITERAL}`, 'g');
  const RULES = new RegExp(String.raw`IllegalAction\(\s*${LITERAL}`, 'g');
  const SEATS = new RegExp(String.raw`NotYourMove\(\s*${LITERAL}`, 'g');
  const ROOM_REQUEST = new RegExp(String.raw`ok: false, error: ${LITERAL}`, 'g');

  /** The message as the server sends it: escapes undone, and a template's `${…}` read as a sample value. */
  function sent(literal: string): string {
    return literal.replace(/\$\{[^}]*\}/g, '3').replace(/\\(.)/g, '$1');
  }

  function found(files: readonly Source[], pattern: RegExp, status?: number): Array<{ status: number; message: string }> {
    return files.flatMap(({ text }) => [...text.matchAll(pattern)].map((m) => ({ status: status ?? Number(m.groups!['status']), message: sent(m.groups!['message']!) })));
  }

  /** Every refusal the code constructs. */
  const CALL = /new (?:HttpError|IllegalAction|NotYourMove)\(/g;
  /** A construction whose message is written right there, so the patterns above read it. */
  const WRITTEN = new RegExp(String.raw`^new (?:HttpError\(\s*\d{3},\s*|IllegalAction\(\s*|NotYourMove\(\s*)${LITERAL}`);
  /**
   * The constructions that pass on a message written somewhere else, each
   * with where that message is checked instead.
   */
  const PASSED_ON = [
    // lib/live/service.ts: the engine's and the table's refusals, read above as IllegalAction and NotYourMove.
    'new HttpError(status, (err as Error).message)',
    // app/api/rooms/route.ts: parseRoomRequest's refusals, read above as `ok: false` results.
    'new HttpError(400, request.error)',
  ];

  /** Constructions none of the patterns can read: each one is a message this scan would miss. */
  function unread(files: readonly Source[]): string[] {
    return files.flatMap(({ path, text }) =>
      [...text.matchAll(CALL)]
        .filter((m) => !WRITTEN.test(text.slice(m.index)) && !PASSED_ON.some((call) => text.startsWith(call, m.index)))
        .map((m) => `${path}: ${text.slice(m.index, text.indexOf('\n', m.index))}`),
    );
  }

  const server = [...sources(join(web, 'lib')), ...sources(join(web, 'app'))];
  const rules = sources(engine);
  const http = found(server, HTTP);
  const refusals = found([...rules, ...server], RULES, 400);
  const seats = found(server, SEATS, 403);
  const roomRequests = found(server, ROOM_REQUEST, 400);

  it('reads a message in any quote, with a template read as the server would fill it', () => {
    const src = [
      {
        path: 'x.ts',
        text: `throw new HttpError(409, "this table's already started"); throw new IllegalAction(\`exchange exactly \${step.count} tiles\`); throw new NotYourMove('it\\'s a bot');`,
      },
    ];
    expect(found(src, HTTP)).toEqual([{ status: 409, message: "this table's already started" }]);
    expect(found(src, RULES, 400)).toEqual([{ status: 400, message: 'exchange exactly 3 tiles' }]);
    expect(found(src, SEATS, 403)).toEqual([{ status: 403, message: "it's a bot" }]);
    expect(unread(src)).toEqual([]);
  });

  it('flags a refusal whose message it cannot read', () => {
    const src = [{ path: 'x.ts', text: 'if (a) throw new HttpError(409, reason);\nif (b) throw new IllegalAction(why);\nif (c) throw new NotYourMove(String(seat));\n' }];
    expect(unread(src)).toEqual(['x.ts: new HttpError(409, reason);', 'x.ts: new IllegalAction(why);', 'x.ts: new NotYourMove(String(seat));']);
  });

  it('finds the messages it is meant to check', () => {
    expect(http.map((m) => m.message)).toEqual(expect.arrayContaining(['stale version', 'lost the race', 'no room with that code', 'this table is full']));
    expect(refusals.map((m) => m.message)).toEqual(expect.arrayContaining(['not your turn', 'illegal claim', 'exchange exactly 3 tiles']));
    expect(seats.map((m) => m.message)).toEqual(expect.arrayContaining(['that seat is a bot']));
    expect(roomRequests.map((m) => m.message)).toEqual(expect.arrayContaining(['that is not a room request', 'rooms play Karachi rules']));
  });

  it('can read every refusal the server and the engine construct', () => {
    expect(unread([...server, ...rules])).toEqual([]);
  });

  it('gives each one its own line, never the shrug', () => {
    for (const { status, message } of [...http, ...refusals, ...seats, ...roomRequests]) {
      if (message === 'something went wrong') continue; // the 500 itself: the shrug is its line
      expect(api(status, message), `${status} ${message}`).not.toBe(FALLBACK);
    }
  });
});

describe('player copy writes one apostrophe', () => {
  const web = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

  it('uses the straight one on every page and in every line the pages share, as plain.ts does', () => {
    const files = [
      ...(readdirSync(join(web, 'app'), { recursive: true }) as string[]).map((f) => join('app', f)),
      ...(readdirSync(join(web, 'components'), { recursive: true }) as string[]).map((f) => join('components', f)),
      join('lib', 'live', 'plain.ts'),
      join('lib', 'report-error.ts'),
    ].filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    const curly = files.filter((f) => /[‘’]/.test(readFileSync(join(web, f), 'utf8')));
    expect(curly).toEqual([]);
  });
});
