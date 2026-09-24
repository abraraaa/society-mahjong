import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { POST } from './route';

const ENDPOINT = 'https://societymahjong.app/api/client-errors';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJndWVzdC0xIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

let log: MockInstance<typeof console.error>;
beforeEach(() => {
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
});

function post(body: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
  return POST(new Request(ENDPOINT, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8', 'user-agent': UA, ...headers } }));
}

/** The one line the route logged, parsed. */
function logged(): Record<string, unknown> {
  expect(log).toHaveBeenCalledTimes(1);
  const [line, ...rest] = log.mock.calls[0] ?? [];
  expect(rest).toEqual([]);
  expect(typeof line).toBe('string');
  expect(line as string).not.toContain('\n');
  return JSON.parse(line as string);
}

describe('POST /api/client-errors', () => {
  it('logs one structured line with the three fields and the user agent, and answers 204 with no body', async () => {
    const res = await post(JSON.stringify({ message: 'Cannot read properties of undefined', digest: '2861937441', path: '/g/abc' }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(logged()).toEqual({ event: 'client_error', message: 'Cannot read properties of undefined', digest: '2861937441', path: '/g/abc', userAgent: UA });
  });

  it('takes a JSON content type as well as the text/plain a beacon sends', async () => {
    const res = await post(JSON.stringify({ message: 'boom', path: '/' }), { 'content-type': 'application/json' });
    expect(res.status).toBe(204);
    expect(logged()).toMatchObject({ message: 'boom', digest: null, path: '/' });
  });

  it('ignores every other field in the body', async () => {
    const res = await post(JSON.stringify({ message: 'boom', path: '/room', stack: 'at x (y.js:1)', cookie: 'sb=1', token: JWT, name: 'Abrar', nested: { a: 1 } }));
    expect(res.status).toBe(204);
    expect(Object.keys(logged()).sort()).toEqual(['digest', 'event', 'message', 'path', 'userAgent']);
  });

  it('never logs the cookies or the authorization header the request came with', async () => {
    const res = await post(JSON.stringify({ message: 'boom', path: '/g/abc' }), {
      cookie: 'sb-project-auth-token=base64-secretcookievalue; sm-session=opaque123',
      authorization: 'Bearer supersecretbearer',
      'x-forwarded-for': '203.0.113.9',
    });
    expect(res.status).toBe(204);
    const line = log.mock.calls[0]?.[0] as string;
    for (const secret of ['secretcookievalue', 'opaque123', 'supersecretbearer', 'sb-project-auth-token', '203.0.113.9']) expect(line).not.toContain(secret);
  });

  it('scrubs a credential quoted inside the message', async () => {
    await post(JSON.stringify({ message: `refresh failed for Bearer ${JWT} (access_token=abc123)`, path: '/g/abc' }));
    const { message } = logged();
    expect(message).toBe('refresh failed for Bearer [redacted] (access_token=[redacted])');
  });

  it('logs the path without its query or fragment', async () => {
    await post(JSON.stringify({ message: 'boom', path: '/r/KHI-ABCD?code=oauth-code#access_token=abc' }));
    expect(logged().path).toBe('/r/KHI-ABCD');
  });

  it('cuts each field and the user agent to 500 characters', async () => {
    const long = 'x'.repeat(900);
    await post(JSON.stringify({ message: long, digest: long, path: `/${long}` }), { 'user-agent': 'U'.repeat(900) });
    const line = logged();
    expect(line.message).toBe('x'.repeat(500));
    expect(line.digest).toBe('x'.repeat(500));
    expect(line.path).toBe(`/${'x'.repeat(499)}`);
    expect(line.userAgent).toBe('U'.repeat(500));
  });

  it('treats a field that is not a string as missing', async () => {
    await post(JSON.stringify({ message: { toString: 'boom' }, digest: 42, path: '/play/solo' }));
    expect(logged()).toMatchObject({ message: null, digest: null, path: '/play/solo' });
  });

  it('logs a missing user agent as null', async () => {
    const res = await POST(new Request(ENDPOINT, { method: 'POST', body: JSON.stringify({ message: 'boom' }) }));
    expect(res.status).toBe(204);
    expect(logged().userAgent).toBeNull();
  });

  it('takes a body of exactly 4 KB', async () => {
    const shell = JSON.stringify({ message: 'boom', pad: '' });
    const body = JSON.stringify({ message: 'boom', pad: 'p'.repeat(4096 - shell.length) });
    expect(new TextEncoder().encode(body).length).toBe(4096);
    expect((await post(body)).status).toBe(204);
  });

  it('refuses a body over 4 KB with 413 and logs nothing', async () => {
    const body = JSON.stringify({ message: 'm'.repeat(4100) });
    const res = await post(body);
    expect(res.status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it('counts bytes, not characters', async () => {
    // 1,400 three-byte characters: well under 4,096 characters, over 4,096 bytes.
    const res = await post(JSON.stringify({ message: '萬'.repeat(1400) }));
    expect(res.status).toBe(413);
    expect(log).not.toHaveBeenCalled();
  });

  it('refuses a large declared length without reading the body', async () => {
    const req = new Request(ENDPOINT, { method: 'POST', body: JSON.stringify({ message: 'boom' }), headers: { 'content-length': '100000' } });
    const read = vi.spyOn(req, 'text');
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect(req.bodyUsed).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('stops reading a streamed body without a length once it passes 4 KB', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(chunk);
      },
    });
    const res = await POST(new Request(ENDPOINT, { method: 'POST', body: stream, duplex: 'half' } as RequestInit));
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(7);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', 'message=boom'],
    ['an empty body', ''],
    ['JSON that is not an object', '"boom"'],
    ['an array', '[{"message":"boom"}]'],
    ['an object with none of the three fields', '{"stack":"at x","message":"   "}'],
  ])('answers 400 to %s and logs nothing', async (_, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps a message with line breaks on one log line', async () => {
    await post(JSON.stringify({ message: 'first\nsecond\r\nthird', path: '/' }));
    expect(logged().message).toBe('first\nsecond\r\nthird');
  });
});
