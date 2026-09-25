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

/**
 * Characters JSON.stringify leaves raw that can still spoil a log line: DEL
 * and the C1 controls (U+007F to U+009F), which some terminals act on; the
 * line and paragraph separators (U+2028, U+2029), which some log viewers
 * break a line at; and the bidi controls, which can make a line read in a
 * different order from the one it was written in.
 */
const UNSAFE_IN_LOG = /[\x7f-\x9f\u{061c}\u{200e}\u{200f}\u{2028}\u{2029}\u{202a}-\u{202e}\u{2066}-\u{2069}]/gu;

/**
 * One log line as JSON, with the characters above escaped as \uXXXX. They
 * only ever sit inside a string, so the line still parses to exactly the
 * same value. Every JSON line the server writes goes through this.
 */
export function safeJson(line: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(line).replace(UNSAFE_IN_LOG, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

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
    return safeJson({ level: 'error', event, ...context, ...errorFacts(err) });
  } catch {
    return safeJson({ level: 'error', event, message: 'the error could not be described' });
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
    return safeJson({
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
    return safeJson({ level: 'error', event: 'request_error', message: 'the error could not be described' });
  }
}
