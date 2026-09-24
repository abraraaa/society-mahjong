import { describe, expect, it } from 'vitest';
import { REPORT_BODY_MAX, REPORT_FIELD_MAX, cleanReport, clip, pathOnly, reportBody, reportFor, scrub } from './client-errors';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJndWVzdC0xIn0.c2lnbmF0dXJlLXNpZ25hdHVyZQ';
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('clip', () => {
  it('trims, cuts to 500 characters, and gives null for anything empty or not a string', () => {
    expect(clip('  boom  ')).toBe('boom');
    expect(clip('x'.repeat(501))).toHaveLength(REPORT_FIELD_MAX);
    expect(clip('   ')).toBeNull();
    expect(clip('')).toBeNull();
    expect(clip(42)).toBeNull();
    expect(clip(null)).toBeNull();
    expect(clip(undefined)).toBeNull();
  });
});

describe('pathOnly', () => {
  it('drops the query and the fragment', () => {
    expect(pathOnly('/r/KHI-ABCD?code=abc')).toBe('/r/KHI-ABCD');
    expect(pathOnly('/g/1#access_token=abc')).toBe('/g/1');
    expect(pathOnly('/play/solo')).toBe('/play/solo');
    expect(pathOnly(7)).toBe(7);
  });
});

describe('scrub', () => {
  it.each([
    [`jwt ${JWT} end`, 'jwt [redacted] end'],
    [`Authorization: Bearer ${JWT}`, 'Authorization: Bearer [redacted]'],
    ['Authorization: Basic dXNlcjpwYXNz', 'Authorization: Basic [redacted]'],
    ['cookie: sb-abc-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0; theme=dark', 'cookie: sb-abc-auth-token=[redacted]; theme=dark'],
    ['GET /api/health?key=hunter2&x=1 failed', 'GET /api/health?key=[redacted]&x=1 failed'],
    ['callback?code=0f1e2d3c&state=ok', 'callback?code=[redacted]&state=ok'],
    ['{"access_token": "abc.def", "expires_in": 3600}', '{"access_token": "[redacted]", "expires_in": 3600}'],
    ['{"refresh_token":"r-123","user":"x"}', '{"refresh_token":"[redacted]","user":"x"}'],
    ['(api_secret=zzz)', '(api_secret=[redacted])'],
  ])('redacts %s', (input, output) => {
    expect(scrub(input)).toBe(output);
  });

  it.each([
    "Cannot read properties of undefined (reading 'concealed')",
    'Minified React error #418; visit https://react.dev/errors/418?args[]=text for the full message',
    'statusCode=409 errorCode=E156',
    'Loading chunk 812 failed. (error: https://societymahjong.app/_next/static/chunks/0e-btmb9lff-7.js)',
    '{"seat":2,"phase":"claim"}',
  ])('leaves an ordinary message alone: %s', (message) => {
    expect(scrub(message)).toBe(message);
  });

  it('stays quick on a hostile message the size of the largest body', () => {
    const hostile = ['token-'.repeat(700), 'eyJ-'.repeat(1000), '"key'.repeat(1000), 'a='.repeat(2000), 'Bearer '.repeat(600)];
    const start = performance.now();
    for (const text of hostile) scrub(text.slice(0, REPORT_BODY_MAX));
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe('cleanReport', () => {
  it('keeps the three string fields and drops the rest', () => {
    expect(cleanReport({ message: 'boom', digest: '123', path: '/g/1?x=1', stack: 'at y', cookie: 'a=b' })).toEqual({ message: 'boom', digest: '123', path: '/g/1' });
  });

  it('scrubs before cutting, so no half of a secret is left at the cut', () => {
    // Cut first, the 500th character falls inside the token's first part, which no longer looks like a JWT.
    const message = `${'x'.repeat(470)} ${JWT}`;
    expect(scrub(message.slice(0, REPORT_FIELD_MAX))).toContain('eyJhbGci');
    expect(cleanReport({ message })?.message).toBe(`${'x'.repeat(470)} [redacted]`);
  });

  it('gives null for anything that is not an object carrying at least one of the fields', () => {
    for (const body of [undefined, null, 'boom', 42, true, [], [{ message: 'boom' }], {}, { message: 7, digest: {}, path: '' }]) expect(cleanReport(body)).toBeNull();
  });
});

describe('reportFor', () => {
  it('takes the message and digest from an Error, and the path without its query', () => {
    const err = Object.assign(new Error('An error occurred in the Server Components render.'), { digest: '2861937441' });
    expect(reportFor(err, '/g/abc?seat=2')).toEqual({ message: 'An error occurred in the Server Components render.', digest: '2861937441', path: '/g/abc' });
  });

  it('copes with whatever else a component throws', () => {
    expect(reportFor('plain string', '/')).toEqual({ message: 'plain string', digest: null, path: '/' });
    expect(reportFor(404, '/')).toEqual({ message: '404', digest: null, path: '/' });
    expect(reportFor({ reason: 'x' }, '/')).toEqual({ message: null, digest: null, path: '/' });
    expect(reportFor(undefined, '/room')).toEqual({ message: null, digest: null, path: '/room' });
    expect(reportFor(null, '/room')).toEqual({ message: null, digest: null, path: '/room' });
  });

  it('cuts a long message to size', () => {
    expect(reportFor(new Error('x'.repeat(2000)), '/').message).toHaveLength(REPORT_FIELD_MAX);
  });
});

describe('reportBody', () => {
  it('is the report as JSON', () => {
    const report = { message: 'boom', digest: '1', path: '/g/1' };
    expect(JSON.parse(reportBody(report))).toEqual(report);
  });

  it.each([
    ['three-byte characters', '萬'],
    ['four-byte characters', '🀄'],
    ['control characters that JSON escapes six bytes wide', '\u0001'],
  ])('stays within the route’s limit with fields full of %s', (_, char) => {
    const full = char.repeat(REPORT_FIELD_MAX);
    const body = reportBody({ message: full, digest: full, path: `/${full}` });
    expect(bytes(body)).toBeLessThanOrEqual(REPORT_BODY_MAX);
    // The route takes it and still has something to log.
    const parsed = cleanReport(JSON.parse(body));
    expect(parsed).not.toBeNull();
    expect(parsed?.message?.length).toBeGreaterThan(0);
  });

  it('leaves an ordinary report whole', () => {
    const report = { message: 'x'.repeat(REPORT_FIELD_MAX), digest: 'd'.repeat(REPORT_FIELD_MAX), path: `/${'p'.repeat(REPORT_FIELD_MAX - 1)}` };
    expect(JSON.parse(reportBody(report))).toEqual(report);
  });
});
