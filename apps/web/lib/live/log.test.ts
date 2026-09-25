import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, SupabaseError } from './errors';
import { errorFacts, errorLine, logError, pathOnly, requestErrorLine, safeJson } from './log';
// The file Next loads at the app's root: its onRequestError is tested here, with the logger it uses.
import { onRequestError } from '../../instrumentation';

afterEach(() => {
  vi.restoreAllMocks();
});

/** The one line a spy on console.error received, parsed. */
function onlyLine(log: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  expect(log.mock.calls).toHaveLength(1);
  const [line, ...rest] = log.mock.calls[0]!;
  expect(rest).toEqual([]);
  expect(typeof line).toBe('string');
  expect(line as string).not.toContain('\n');
  return JSON.parse(line as string) as Record<string, unknown>;
}

describe('errorFacts', () => {
  it('keeps what a database failure says, with its code, and the stack', () => {
    const facts = errorFacts(new SupabaseError('read the room', { message: 'relation "public.rooms" does not exist', code: '42P01' }));
    expect(facts).toMatchObject({ name: 'SupabaseError', message: 'could not read the room: relation "public.rooms" does not exist', code: '42P01' });
    // The cause says nothing the message does not, so it is not repeated.
    expect(facts.cause).toBeUndefined();
    expect(facts.stack).toContain('SupabaseError');
  });

  it("never carries an HttpError's snapshot, only its status and message", () => {
    const facts = errorFacts(new HttpError(503, 'the table is resting', { view: { hand: ['m1', 'm2'] }, seed: 'never-log-me' }));
    expect(facts).toMatchObject({ name: 'HttpError', message: 'the table is resting', status: 503 });
    expect(JSON.stringify(facts)).not.toContain('never-log-me');
    expect(JSON.stringify(facts)).not.toContain('m1');
  });

  it('describes a cause that adds something, and a digest', () => {
    const err = Object.assign(new Error('render failed', { cause: new Error('socket hang up') }), { digest: '1234567' });
    expect(errorFacts(err)).toMatchObject({ name: 'Error', message: 'render failed', cause: 'socket hang up', digest: '1234567' });
  });

  it("leaves out PostgREST's hint and details, which can quote the row a write was refused for", () => {
    const err = new SupabaseError('record the result', {
      message: 'new row violates check constraint',
      code: '23514',
      details: 'Failing row contains (g-1, seed-never-log-me, ...)',
      hint: 'Check the winner column',
    } as { message: string; code: string });
    const line = errorLine('route_error', err);
    expect(JSON.parse(line)).toMatchObject({ message: 'could not record the result: new row violates check constraint', code: '23514' });
    for (const leak of ['seed-never-log-me', 'Failing row', 'winner column', 'details', 'hint']) expect(line).not.toContain(leak);
  });

  it('copes with whatever else is thrown', () => {
    expect(errorFacts({ message: 'a raw PostgREST error object', code: 'PGRST116', details: 'Key (code)=(ABCD)' })).toEqual({
      name: 'object',
      message: 'a raw PostgREST error object',
      code: 'PGRST116',
    });
    expect(errorFacts('a string')).toEqual({ name: 'string', message: 'a string' });
    expect(errorFacts(undefined)).toEqual({ name: 'undefined', message: 'undefined' });
    expect(errorFacts(null)).toEqual({ name: 'null', message: 'null' });
    expect(errorFacts({})).toEqual({ name: 'object', message: '(no message)' });
    expect(errorFacts(42)).toEqual({ name: 'number', message: '42' });
  });

  it('clips a runaway message', () => {
    const facts = errorFacts(new Error('x'.repeat(5000)));
    expect(facts.message.length).toBeLessThanOrEqual(1001);
    expect(facts.stack!.length).toBeLessThanOrEqual(4001);
  });
});

describe('errorLine and logError', () => {
  it('writes one JSON line with the event, the context and the facts', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    logError('route_error', new SupabaseError('save the table', { message: 'TypeError: fetch failed' }), { route: '/api/games/[id]/act', gameId: 'g-1', missing: undefined });
    const line = onlyLine(log);
    expect(line).toMatchObject({
      level: 'error',
      event: 'route_error',
      route: '/api/games/[id]/act',
      gameId: 'g-1',
      name: 'SupabaseError',
      message: 'could not save the table: TypeError: fetch failed',
    });
    expect('missing' in line).toBe(false);
  });

  it('still writes a line for something that cannot be described', () => {
    const hostile = new Proxy(
      {},
      {
        has: () => true,
        get: () => {
          throw new Error('no peeking');
        },
      },
    );
    const line = JSON.parse(errorLine('route_error', hostile, { route: '/api/rooms' })) as Record<string, unknown>;
    expect(line).toEqual({ level: 'error', event: 'route_error', message: 'the error could not be described' });
  });
});

describe('safeJson', () => {
  // An 8-bit CSI, NEL, DEL, the line and paragraph separators, and the bidi controls.
  const nasty = 'c1:\u{9b}31mRED nel:\u{85} del:\u{7f} ls:\u{2028} ps:\u{2029} rlo:\u{202e}evil lri:\u{2066}x\u{2069} alm:\u{61c} rlm:\u{200f}';

  it('escapes what JSON.stringify leaves raw, so the line still parses to the same value', () => {
    const line = safeJson({ message: nasty });
    expect(line).not.toMatch(/[\x7f-\x9f\u{61c}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/u);
    expect(line).toContain('\\u009b31mRED nel:\\u0085 del:\\u007f ls:\\u2028 ps:\\u2029 rlo:\\u202eevil lri:\\u2066x\\u2069 alm:\\u061c rlm:\\u200f');
    expect(JSON.parse(line)).toEqual({ message: nasty });
  });

  it('leaves everything else as JSON.stringify writes it', () => {
    const plain = { level: 'error', message: 'Zoë played 🀄 萬 with a\ttab and a "quote"\n', n: 3, none: null };
    expect(safeJson(plain)).toBe(JSON.stringify(plain));
  });

  it('is what errorLine and requestErrorLine write', () => {
    const err = new Error(nasty);
    for (const line of [
      errorLine('route_error', err, { route: '/api/rooms/[code]/join' }),
      requestErrorLine(err, { path: `/r/\u{202e}x`, method: 'GET' }, { routePath: '/r/[code]', routeType: 'render' }),
    ]) {
      expect(line).not.toMatch(/[\x7f-\x9f\u{2028}\u{2029}\u{202e}]/u);
      expect((JSON.parse(line) as { message: string }).message).toBe(nasty);
    }
  });
});

describe('pathOnly', () => {
  it('drops the query string and fragment, where a key or a sign-in code can sit', () => {
    expect(pathOnly('/api/health?key=very-secret')).toBe('/api/health');
    expect(pathOnly('/auth/callback?code=abc#frag')).toBe('/auth/callback');
    expect(pathOnly('/g/123')).toBe('/g/123');
  });

  it('keeps only the path of a whole URL', () => {
    expect(pathOnly('https://societymahjong.app/r/ABCD?x=1')).toBe('/r/ABCD');
    expect(pathOnly('https://societymahjong.app')).toBe('/');
  });
});

describe('onRequestError', () => {
  const request = {
    path: '/api/health?key=very-secret',
    method: 'GET',
    headers: { cookie: 'sb-access-token=eyJsecret', authorization: 'Bearer cron-secret' },
  };
  const context = { routerKind: 'App Router', routePath: '/api/health', routeType: 'route', revalidateReason: undefined } as const;

  it('logs one line: message, digest, path, method, route path and type', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('boom'), { digest: 'd-1' });
    await onRequestError(err, request, context);
    expect(onlyLine(log)).toEqual({
      level: 'error',
      event: 'request_error',
      name: 'Error',
      message: 'boom',
      digest: 'd-1',
      path: '/api/health',
      method: 'GET',
      routePath: '/api/health',
      routeType: 'route',
    });
  });

  it('never writes a header, a cookie, a token or the query string', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onRequestError('a string was thrown', request, { ...context, routeType: 'render', routePath: '/g/[id]' });
    const raw = log.mock.calls[0]![0] as string;
    for (const secret of ['very-secret', 'eyJsecret', 'cron-secret', 'cookie', 'authorization']) expect(raw).not.toContain(secret);
    expect(JSON.parse(raw)).toMatchObject({ message: 'a string was thrown', routeType: 'render', routePath: '/g/[id]' });
    expect(requestErrorLine(new Error('x'), request, context)).not.toContain('headers');
  });
});
