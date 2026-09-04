import 'server-only';
import { NextResponse } from 'next/server';
import { HttpError } from './service';

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}

/** Turn a thrown HttpError into its response; anything else is a 500 with the message logged. */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) return json({ error: err.message, ...(err.body !== undefined ? { snapshot: err.body } : {}) }, err.status);
  console.error(err);
  return json({ error: 'something went wrong' }, 500);
}
