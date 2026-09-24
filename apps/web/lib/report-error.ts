'use client';
import { useEffect, useRef } from 'react';
import { REPORT_URL, reportBody, reportFor } from './client-errors';

/** What both error pages say. The global one can't share the other's markup, only its words. */
export const ERROR_COPY = {
  eyebrow: 'Something went wrong',
  heading: 'That wasn’t meant to happen.',
  line: 'The fault’s ours, not yours. Try again, and if it keeps happening, head back to the start.',
  retry: 'Try again',
  home: 'Back to the start',
} as const;

type Beacon = Pick<Navigator, 'sendBeacon'>;

/**
 * Posts a report body without holding anything up: a beacon when the browser
 * has one, so it still goes if the player leaves the page straight away, and a
 * keepalive fetch otherwise. A string body goes as text/plain, which a beacon
 * can send without asking first. Never throws; a report that can't be sent is
 * dropped. True when it was handed to the browser.
 */
export function sendReport(body: string, nav: Partial<Beacon> | null = globalThis.navigator ?? null, post: typeof fetch | null = globalThis.fetch ?? null): boolean {
  try {
    if (typeof nav?.sendBeacon === 'function' && nav.sendBeacon(REPORT_URL, body)) return true;
  } catch {
    // A beacon can throw or refuse (a full queue); the fetch below is the fallback.
  }
  if (typeof post !== 'function') return false;
  try {
    post(REPORT_URL, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

const reported = new WeakSet<object>();

/**
 * True the first time an error object is seen, so the same crash isn't sent
 * twice when an error page renders again or a second one catches it. A thrown
 * string can't be remembered here; the hook below stops its repeats.
 */
export function firstSighting(error: unknown, seen: WeakSet<object> = reported): boolean {
  if (typeof error !== 'object' || error === null) return true;
  if (seen.has(error)) return false;
  seen.add(error);
  return true;
}

const NOTHING = Symbol('nothing reported');

/** Sends word of the error an error page is showing, once per error, with the page's path (never its query). */
export function useErrorReport(error: unknown): void {
  const last = useRef<unknown>(NOTHING);
  useEffect(() => {
    if (Object.is(last.current, error)) return;
    last.current = error;
    if (!firstSighting(error)) return;
    sendReport(reportBody(reportFor(error, window.location.pathname)));
  }, [error]);
}
