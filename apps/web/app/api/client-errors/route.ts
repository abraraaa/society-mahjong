// Relative, not '@/lib', so vitest can load this handler without an alias.
import { REPORT_BODY_MAX, clip, cleanReport } from '../../../lib/client-errors';

/**
 * Where app/error.tsx and app/global-error.tsx send word of a crash in a
 * player's browser, so it shows up in the server logs next to the server's
 * own errors (a digest ties the two together).
 *
 * Open to anyone, since a crashed page may have no session: it takes a JSON
 * body of `{ message, digest, path }`, keeps those three when they are strings
 * (scrubbed of anything shaped like a credential and cut to 500 characters),
 * ignores everything else, and writes one JSON line to the log with the user
 * agent. It never reads or logs cookies or any other header. The body is read
 * as text whatever its type, as a beacon sends text/plain. Answers 204 when
 * logged, 400 when there's nothing to log, 413 when the body is over 4 KB.
 * Rate limiting belongs at the edge, like every other open route here.
 */
export async function POST(req: Request): Promise<Response> {
  const text = await readUpTo(req, REPORT_BODY_MAX);
  if (text === null) return new Response(null, { status: 413 });
  const report = cleanReport(parse(text));
  if (!report) return new Response(null, { status: 400 });
  console.error(JSON.stringify({ event: 'client_error', ...report, userAgent: clip(req.headers.get('user-agent')) }));
  return new Response(null, { status: 204 });
}

/** The body as text, or null once it passes `max` bytes: a large Content-Length is refused unread, and a body without one is read no further than the limit. */
async function readUpTo(req: Request, max: number): Promise<string | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
