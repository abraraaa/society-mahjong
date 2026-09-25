/**
 * A crash report from a player's browser, shared by the error pages that send
 * it and the /api/client-errors route that logs it. Three short strings and
 * nothing else: what went wrong, the server's reference for it, and where.
 * Nothing in here can identify a player or sign in as one.
 */
export type ClientErrorReport = { message: string | null; digest: string | null; path: string | null };

/** Where the error pages send reports. */
export const REPORT_URL = '/api/client-errors';
/** Each field is cut to this many characters; the user agent too. */
export const REPORT_FIELD_MAX = 500;
/** A body bigger than this many bytes is refused, and read no further. Three full fields of plain text fit with room to spare. */
export const REPORT_BODY_MAX = 4096;

const FIELDS = ['message', 'digest', 'path'] as const;

/** A string field cut to size, or null when there is nothing in it. */
export function clip(value: unknown, max = REPORT_FIELD_MAX): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The address without its query or fragment, which is where sign-in codes and keys travel. */
export function pathOnly(value: unknown): unknown {
  return typeof value === 'string' ? value.split(/[?#]/, 1)[0] : value;
}

// An error message is written by whatever code threw it, so it could quote a
// header, a URL or a response body. Anything shaped like a credential goes.
// The patterns are kept linear (names are matched whole, then tested), since
// anyone can post a message. A bare `code` is an OAuth sign-in code; a
// statusCode or errorCode is kept.
const SECRET_NAME = /token|secret|key|password|session|auth|^code$/i;
// A `name: value` pair is common in ordinary messages ("TypeError: …",
// "Session: expired"), so there the name must be one of these, whole, however
// it is cased or joined: access_token, accessToken and session.access-token
// all count.
const SECRET_KEY = /^(?:(?:access|refresh|provider|providerrefresh|id|captcha)?token|password|passwd|(?:client)?secret|apikey)$/i;

function isSecretKey(name: string): boolean {
  const last = name.slice(name.lastIndexOf('.') + 1);
  return SECRET_KEY.test(last.replace(/[-_]/g, ''));
}

const REDACTED = '[redacted]';

/** The text with anything that looks like a credential replaced. */
export function scrub(text: string): string {
  return (
    text
      // A JWT: a Supabase access token, the inside of its auth cookie, or the body of an hCaptcha answer (P1_eyJ…).
      .replace(/(?<![A-Za-z0-9])eyJ[\w-]{4,}\.[\w-]{4,}(?:\.[\w-]*)?/g, REDACTED)
      // Supabase's newer API keys, and the value of its auth cookie however the cookie is split.
      .replace(/\bsb_(?:secret|publishable)_[\w-]+/g, REDACTED)
      .replace(/\bbase64-[A-Za-z0-9+/=_-]{16,}/g, REDACTED)
      // An Authorization header's value. `Token` only as a header writes it: "unexpected token u in JSON" is an ordinary parse error.
      .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]+/gi, `$1 ${REDACTED}`)
      .replace(/\bToken\s+[\w.~+/=-]+/g, `Token ${REDACTED}`)
      // token=…, api_key=…, sb-…-auth-token=… or its chunks (sb-…-auth-token.0=…), code=… in a query string or a cookie header.
      .replace(/(?<![\w.-])([\w.-]+)=([^\s&;,'"()<>[\]{}]+)/g, (all, name: string) => (SECRET_NAME.test(name) ? `${name}=${REDACTED}` : all))
      // "access_token": "…" in quoted JSON.
      .replace(/"([\w-]+)"(\s*:\s*)"[^"]*"/g, (all, name: string, colon: string) => (SECRET_NAME.test(name) ? `"${name}"${colon}"${REDACTED}"` : all))
      // password: …, {access_token: '…'}, 'refresh_token': '…', unquoted or single-quoted.
      .replace(/(?<![\w.-])(['"]?)([\w.-]+)\1(\s*:\s*)(['"]?)[^\s,;'"}]+\4/g, (all, q: string, name: string, colon: string, v: string) =>
        isSecretKey(name) ? `${q}${name}${q}${colon}${v}${REDACTED}${v}` : all,
      )
  );
}

/**
 * What the route keeps from a posted body: the three fields when they are
 * strings, scrubbed and cut to size, the path without its query. Anything
 * else in the body is dropped. Null when the body isn't an object or has none
 * of the three.
 */
export function cleanReport(body: unknown): ClientErrorReport | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  // Scrubbed before cutting, so a cut can't leave the front half of a secret behind.
  const field = (value: unknown) => clip(typeof value === 'string' ? scrub(value) : value);
  const report: ClientErrorReport = { message: field(raw.message), digest: field(raw.digest), path: field(pathOnly(raw.path)) };
  return report.message !== null || report.digest !== null || report.path !== null ? report : null;
}

/**
 * What an error page reports about a thrown value. Next hands the page an
 * Error, with a digest when it came from the server, but a component can
 * throw anything.
 */
export function reportFor(error: unknown, path: string): ClientErrorReport {
  const thrown = typeof error === 'object' && error !== null ? (error as { message?: unknown; digest?: unknown }) : null;
  const message = thrown ? thrown.message : typeof error === 'string' || typeof error === 'number' ? String(error) : null;
  return { message: clip(message), digest: clip(thrown?.digest), path: clip(pathOnly(path)) };
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/**
 * The report as the JSON body to post, short enough that the route will take
 * it. Only a message full of non-Latin text or control characters needs more
 * than the per-field cut; the longest field is halved until it fits.
 */
export function reportBody(report: ClientErrorReport): string {
  const fields = { message: clip(report.message), digest: clip(report.digest), path: clip(report.path) };
  let body = JSON.stringify(fields);
  while (bytes(body) > REPORT_BODY_MAX) {
    const longest = FIELDS.reduce((a, b) => ((fields[b]?.length ?? 0) > (fields[a]?.length ?? 0) ? b : a));
    const value = fields[longest] ?? '';
    fields[longest] = value.slice(0, Math.floor(value.length / 2)) || null;
    body = JSON.stringify(fields);
  }
  return body;
}
