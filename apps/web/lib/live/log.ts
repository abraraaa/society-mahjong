/**
 * Server errors as one JSON line each, so Vercel's function logs can be
 * searched by field ("event", "route", "gameId") rather than read by eye.
 *
 * Only what describes the failure is written: the error's name, message,
 * status, code and digest, its cause's message, its stack, and whatever
 * context the caller names. Never a request or response body, a header, a
 * cookie or a token: an HttpError's snapshot (someone's hand) stays out, and
 * so does a query string, which is where /api/health carries its key.
 *
 * No 'server-only' import and nothing from Node: instrumentation.ts loads
 * this too, and Next may run that in either runtime.
 */

/** Plain values that say where a failure happened. Keys must not reuse the names in ErrorFacts, which win. */
export type LogContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

/** What a log line says about the thing that was thrown. */
export interface ErrorFacts {
  /** the Error's name, or what kind of value was thrown when it was not an Error */
  readonly name: string;
  readonly message: string;
  /** an HttpError's or an Auth error's HTTP status */
  readonly status?: number;
  /** Postgres, PostgREST or Node's own error code */
  readonly code?: string;
  /** the id Next and React give an error, which a player's error page shows */
  readonly digest?: string;
  /** the message of whatever the error wraps, when it adds something */
  readonly cause?: string;
  readonly stack?: string;
}

const MAX_MESSAGE = 1000;
const MAX_STACK = 4000;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function field(x: unknown, key: string): unknown {
  return typeof x === 'object' && x !== null && key in x ? (x as Record<string, unknown>)[key] : undefined;
}

/** Describe anything thrown, picking only the fields above: never `body`, never a snapshot. */
export function errorFacts(err: unknown): ErrorFacts {
  const isObject = typeof err === 'object' && err !== null;
  const rawMessage = field(err, 'message');
  const message = clip(typeof rawMessage === 'string' ? rawMessage : isObject ? '(no message)' : String(err), MAX_MESSAGE);
  const facts: { -readonly [K in keyof ErrorFacts]: ErrorFacts[K] } = { name: err instanceof Error ? err.name : err === null ? 'null' : typeof err, message };
  const status = field(err, 'status');
  if (typeof status === 'number') facts.status = status;
  const code = field(err, 'code');
  if ((typeof code === 'string' && code !== '') || typeof code === 'number') facts.code = String(code);
  const digest = field(err, 'digest');
  if (typeof digest === 'string') facts.digest = digest;
  const cause = field(field(err, 'cause'), 'message');
  if (typeof cause === 'string' && cause !== '' && !message.includes(cause)) facts.cause = clip(cause, MAX_MESSAGE);
  if (err instanceof Error && err.stack) facts.stack = clip(err.stack, MAX_STACK);
  return facts;
}

/** The JSON line for one failure. It never throws: a value that cannot be described still gets a line. */
export function errorLine(event: string, err: unknown, context: LogContext = {}): string {
  try {
    return JSON.stringify({ level: 'error', event, ...context, ...errorFacts(err) });
  } catch {
    return JSON.stringify({ level: 'error', event, message: 'the error could not be described' });
  }
}

/** Log one failure as one line. */
export function logError(event: string, err: unknown, context: LogContext = {}): void {
  console.error(errorLine(event, err, context));
}

/**
 * The path a request was for, without its query string or fragment (a key
 * or a sign-in code can sit there), and without a scheme and host when Next
 * hands over a whole URL.
 */
export function pathOnly(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? '';
  const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(bare);
  return url ? (url[1] ?? '/') : bare;
}

/** What Next passes onRequestError that is safe to log. Headers are left out of the type, so they cannot be logged by accident. */
export interface RequestFacts {
  readonly path: string;
  readonly method: string;
}
export interface RouteFacts {
  readonly routePath: string;
  readonly routeType: string;
}

/**
 * The line for an error Next caught because nothing else did: its message
 * and digest, the path and method, and the route file and kind (render,
 * route, action or proxy). Next logs the error and its stack itself; this
 * line is the one that can be searched.
 */
export function requestErrorLine(err: unknown, request: RequestFacts, context: RouteFacts): string {
  try {
    const { name, message, digest } = errorFacts(err);
    return JSON.stringify({
      level: 'error',
      event: 'request_error',
      name,
      message,
      ...(digest !== undefined ? { digest } : {}),
      path: pathOnly(request.path),
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
    });
  } catch {
    return JSON.stringify({ level: 'error', event: 'request_error', message: 'the error could not be described' });
  }
}
