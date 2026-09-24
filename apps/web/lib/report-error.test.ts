import { describe, expect, it, vi } from 'vitest';
import { REPORT_URL } from './client-errors';
import { ERROR_COPY, firstSighting, onceOnly, sendReport } from './report-error';

const BODY = '{"message":"boom","digest":null,"path":"/g/1"}';

describe('sendReport', () => {
  it('sends a beacon when the browser takes one, and nothing else', () => {
    const sendBeacon = vi.fn(() => true);
    const post = vi.fn();
    expect(sendReport(BODY, { sendBeacon }, post)).toBe(true);
    expect(sendBeacon).toHaveBeenCalledExactlyOnceWith(REPORT_URL, BODY);
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['refuses the beacon', { sendBeacon: vi.fn(() => false) }],
    [
      'throws on the beacon',
      {
        sendBeacon: vi.fn(() => {
          throw new TypeError('Illegal invocation');
        }),
      },
    ],
    ['has no beacon', {}],
    ['has no navigator', null],
  ])('falls back to a keepalive fetch when the browser %s', (_, nav) => {
    const post = vi.fn(async () => new Response(null, { status: 204 }));
    expect(sendReport(BODY, nav, post)).toBe(true);
    expect(post).toHaveBeenCalledExactlyOnceWith(REPORT_URL, { method: 'POST', body: BODY, keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' } });
  });

  it('swallows a fetch that fails', async () => {
    const post = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(sendReport(BODY, {}, post)).toBe(true);
    await Promise.resolve();
  });

  it('never throws, even when there is nothing to send with', () => {
    expect(sendReport(BODY, {}, null)).toBe(false);
    expect(sendReport(BODY, null, null)).toBe(false);
    expect(
      sendReport(BODY, {}, () => {
        throw new TypeError('keepalive quota');
      }),
    ).toBe(false);
  });
});

describe('firstSighting', () => {
  it('is true once per error object', () => {
    const seen = new WeakSet<object>();
    const a = new Error('a');
    const b = new Error('a');
    expect(firstSighting(a, seen)).toBe(true);
    expect(firstSighting(a, seen)).toBe(false);
    expect(firstSighting(b, seen)).toBe(true);
  });

  it('cannot remember a thrown string or nothing, so says yes', () => {
    const seen = new WeakSet<object>();
    expect(firstSighting('boom', seen)).toBe(true);
    expect(firstSighting('boom', seen)).toBe(true);
    expect(firstSighting(undefined, seen)).toBe(true);
  });
});

describe('onceOnly', () => {
  it('passes on the first report and drops the rest', () => {
    const send = vi.fn(() => true);
    const report = onceOnly(send);
    report('first');
    report('second');
    report('first');
    expect(send).toHaveBeenCalledExactlyOnceWith('first');
  });

  it('keeps its own count: two senders report once each', () => {
    const send = vi.fn(() => true);
    onceOnly(send)('a');
    onceOnly(send)('b');
    expect(send.mock.calls).toEqual([['a'], ['b']]);
  });
});

describe('ERROR_COPY', () => {
  it('offers another go and a way home, in plain words', () => {
    expect(ERROR_COPY.retry).toBe('Try again');
    expect(ERROR_COPY.home).toBe('Back to the start');
    const all = Object.values(ERROR_COPY).join(' ');
    expect(all).not.toMatch(/\b(error|exception|server|version|stale|race|token|digest|crash)\b/i);
  });
});
