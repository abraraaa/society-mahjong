import 'server-only';
import { NextResponse } from 'next/server';
import { HttpError } from './errors';
import { logError } from './log';

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Turn a thrown HttpError into its response. Anything else, a SupabaseError
 * included, is a 500 with a generic message: the detail goes to the server
 * log and never to the player.
 *
 * A refusal (a 4xx HttpError) is the table working as meant and is not
 * logged. Anything unexpected, an HttpError of 500 or more included, is
 * logged once here, as one JSON line naming `route` (the route file's path,
 * as in '/api/games/[id]/act'), so no caller logs it again.
 */
export function errorResponse(err: unknown, route?: string): NextResponse {
  if (err instanceof HttpError) {
    if (err.status >= 500) logError('route_error', err, { route });
    return json({ error: err.message, ...(err.body !== undefined ? { snapshot: err.body } : {}) }, err.status);
  }
  logError('route_error', err, { route });
  return json({ error: 'something went wrong' }, 500);
}
