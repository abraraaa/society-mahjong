import type { Instrumentation } from 'next';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { requestErrorLine } from './lib/live/log';

/**
 * Every server error nothing else caught (a page that failed to render, a
 * route handler that threw past its own catch, the proxy) as one JSON line
 * in the function logs. The route handlers under app/api catch their own
 * errors and log them through errorResponse, so they only land here if that
 * fails. Only the message, digest, path, method and route are written: the
 * request's headers, cookies and body never are.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  console.error(requestErrorLine(err, request, context));
};
