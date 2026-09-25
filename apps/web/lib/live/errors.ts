/** A rejection with an HTTP status, and optionally a body (a snapshot) the client can use to catch up. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** What Supabase hands back when a call fails: PostgREST's error, the network failure it caught, or an Auth error. */
export interface SupabaseFailure {
  readonly message: string;
  readonly code?: string | undefined;
}

/**
 * A Supabase call that failed. It is deliberately not an HttpError: nothing
 * in it reaches a player. errorResponse answers 500 with a generic message
 * and logs this, but only its message (which carries Supabase's own) and its
 * code, plus the cause's message if it ever says more (see errorFacts in
 * log.ts). The original error is kept as `cause`, but its `hint` and
 * `details` are left out of the log on purpose: PostgREST's details can
 * quote the row a write was refused for, such as a game's seed or every
 * seat's tiles in live_state.
 */
export class SupabaseError extends Error {
  readonly code: string | undefined;
  constructor(
    readonly what: string,
    failure: SupabaseFailure,
  ) {
    super(`could not ${what}: ${failure.message}`, { cause: failure });
    this.name = 'SupabaseError';
    this.code = failure.code || undefined;
  }
}

/**
 * The data from a Supabase result, or a SupabaseError when the call failed.
 * `what` says what the call was for, in the log ("read the room"). Every
 * read and write in the store goes through this, so a database that is down
 * or refusing surfaces as a 500, never as "no room with that code" or an
 * empty table. A read that finds nothing still returns its null or [].
 */
export function must<T>(result: { readonly data: T; readonly error: SupabaseFailure | null }, what: string): T {
  if (result.error) throw new SupabaseError(what, result.error);
  return result.data;
}
