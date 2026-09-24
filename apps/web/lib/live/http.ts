import 'server-only';
import { NextResponse } from 'next/server';
import { HttpError } from './errors';

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Turn a thrown HttpError into its response. Anything else, a SupabaseError
 * included, is a 500 with a generic message: the detail goes to the server
 * log and never to the player.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) return json({ error: err.message, ...(err.body !== undefined ? { snapshot: err.body } : {}) }, err.status);
  console.error(err);
  return json({ error: 'something went wrong' }, 500);
}
