import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from './client';
import { plainError } from './plain';

const FALLBACK = 'Something went wrong. Try again.';
const api = (status: number, message: string) => plainError(new ApiError(status, message));

describe('plainError: the lines the copy calls for', () => {
  it('a tap that lost to another one says the table moved on', () => {
    const line = "That didn't go through. The table had moved on, so try again.";
    expect(api(409, 'stale version')).toBe(line);
    expect(api(409, 'lost the race')).toBe(line);
  });

  it('a game already under way promises a seat at the next one', () => {
    expect(api(409, 'this table has already started')).toBe("This game's already under way. You'll get a seat when the next one starts.");
  });

  it('a code with no room behind it says to check it', () => {
    expect(api(404, 'no room with that code')).toBe("There's no table with that code. Check it with whoever sent you the link.");
  });

  it('someone not at the table is pointed to the host', () => {
    expect(api(403, 'not at this table')).toBe("You're not seated at this table. Ask the host for the link.");
    expect(api(403, 'not seated at this table')).toBe("You're not seated at this table. Ask the host for the link.");
  });

  it('a full table says so', () => {
    expect(api(409, 'this table is full')).toBe("This table's full.");
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

  it('anything else is a plain shrug with a next step', () => {
    expect(api(500, 'something went wrong')).toBe(FALLBACK);
    expect(api(502, 'Bad Gateway')).toBe(FALLBACK);
    expect(api(504, 'the server answered 504')).toBe(FALLBACK);
    expect(api(418, 'a brand new server message')).toBe(FALLBACK);
    expect(plainError('challenge-closed')).toBe(FALLBACK);
    expect(plainError(new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) must be set'))).toBe(FALLBACK);
    expect(plainError(null)).toBe(FALLBACK);
    expect(plainError(undefined)).toBe(FALLBACK);
    expect(plainError(42)).toBe(FALLBACK);
    expect(plainError({})).toBe(FALLBACK);
  });
});

describe('plainError: the rest of what the server can say', () => {
  it('other lost races say the same as a stale tap', () => {
    const line = "That didn't go through. The table had moved on, so try again.";
    expect(api(409, 'that seat was just taken; try again')).toBe(line);
    expect(api(409, 'the table changed under you; try again')).toBe(line);
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
      'an action is required',
    ])
      expect(api(m === 'action is not for your seat' ? 403 : 400, m), m).toBe(line);
  });

  it('a seat a bot has taken says when the player can come back', () => {
    expect(api(403, 'that seat is a bot')).toBe("A bot's playing your seat for the rest of this game. You can sit back down when the next one starts.");
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

  it('a lapsed session says to reload, by message or by any 401', () => {
    const line = "We've lost track of who you are. Reload the page to sit back down.";
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

  it('reads the message loosely: case and stray space', () => {
    expect(api(409, '  Stale Version ')).toBe("That didn't go through. The table had moved on, so try again.");
  });

  it('an Object.prototype name is not mistaken for a server message', () => {
    expect(api(400, 'constructor')).toBe(FALLBACK);
    expect(api(400, 'toString')).toBe(FALLBACK);
  });
});

/**
 * Every refusal a player can reach, read from the source: HttpError in the
 * server code, the engine's IllegalAction (a 400 at the table) and the
 * table's NotYourMove (a 403). A new message with no line in plain.ts fails
 * here rather than reaching a player as the shrug.
 */
describe('plainError covers every message the server can send', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const web = join(here, '..', '..');
  const engine = join(web, '..', '..', 'packages', 'engine', 'src');

  function sources(dir: string): string[] {
    return (readdirSync(dir, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => readFileSync(join(dir, f), 'utf8'));
  }

  function found(files: string[], pattern: RegExp): Array<{ status: number; message: string }> {
    return files.flatMap((src) => [...src.matchAll(pattern)].map((m) => ({ status: m.groups?.['status'] ? Number(m.groups['status']) : 0, message: m.groups!['message']! })));
  }

  const server = [...sources(join(web, 'lib', 'live')), ...sources(join(web, 'app', 'api'))];
  const http = found(server, /HttpError\(\s*(?<status>\d{3}),\s*'(?<message>[^']+)'/g);
  const rules = found(sources(engine), /IllegalAction\(\s*'(?<message>[^']+)'/g).map((m) => ({ ...m, status: 400 }));
  const seats = found(server, /NotYourMove\(\s*'(?<message>[^']+)'/g).map((m) => ({ ...m, status: 403 }));

  it('finds the messages it is meant to check', () => {
    expect(http.map((m) => m.message)).toEqual(expect.arrayContaining(['stale version', 'lost the race', 'no room with that code', 'this table is full']));
    expect(rules.map((m) => m.message)).toEqual(expect.arrayContaining(['not your turn', 'illegal claim']));
    expect(seats.map((m) => m.message)).toEqual(expect.arrayContaining(['that seat is a bot']));
  });

  it('gives each one its own line, never the shrug', () => {
    for (const { status, message } of [...http, ...rules, ...seats]) {
      if (message === 'something went wrong') continue; // the 500 itself: the shrug is its line
      expect(api(status, message), `${status} ${message}`).not.toBe(FALLBACK);
    }
  });
});
