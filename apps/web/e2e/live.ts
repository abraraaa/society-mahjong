import { expect, type Locator, type Page, type Route, type WebSocketRoute } from '@playwright/test';
import type { GameSnapshot } from '../lib/live/snapshot';
import type { ClientAction } from '../lib/live/types';
import { GAME_ID, USER_ID, USER_NAME, serve } from './fixtures';

/**
 * A seat at a live table with no server behind it. The game routes are
 * answered by the test, Supabase Auth by a signed-in guest, and Realtime by a
 * Phoenix socket whose joins the test can hold and whose connection it can
 * drop. What the page asked for is logged, in order, for the test to check.
 */

export const SUPABASE_URL = 'http://127.0.0.1:3499';
export const GAME_TOPIC = `realtime:game:${GAME_ID}`;

/** An answer from a game route. */
export interface Answer {
  readonly status?: number;
  readonly body: unknown;
}

/** What a game route does with a request: answers it, or holds it with no answer at all until the test releases it. */
export type Reply = Answer | 'hold';

export const ok = (s: GameSnapshot): Answer => ({ status: 200, body: serve(s) });
export const conflict = (s: GameSnapshot): Answer => ({ status: 409, body: { error: 'stale version', snapshot: serve(s) } });

export interface ActBody {
  readonly action: ClientAction;
  readonly expectedVersion: number;
}

export interface Call {
  readonly kind: 'view' | 'act' | 'tick';
  /** 1-based, per kind */
  readonly n: number;
  readonly body: ActBody | null;
  readonly route: Route;
}

export interface GameRoutes {
  readonly view: (n: number) => Reply;
  readonly act?: (body: ActBody, n: number) => Reply;
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');

/** A Supabase session for the guest, as @supabase/ssr keeps it in its cookie. It is never checked: the fake Auth takes anything. */
function sessionCookie(): string {
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const claims = { sub: USER_ID, aud: 'authenticated', role: 'authenticated', exp, iat: exp - 3600, session_id: 'e2e', is_anonymous: true };
  const accessToken = [b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), b64url(JSON.stringify(claims)), 'sig'].join('.');
  const session = { access_token: accessToken, token_type: 'bearer', expires_in: 365 * 24 * 3600, expires_at: exp, refresh_token: 'e2e-refresh', user: guestUser() };
  return `base64-${b64url(JSON.stringify(session))}`;
}

function guestUser() {
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    is_anonymous: true,
    user_metadata: { display_name: USER_NAME },
    app_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
}

interface Socket {
  readonly ws: WebSocketRoute;
  open: boolean;
  /** Phoenix's v2 serializer sends arrays; v1 sends objects. Answer in kind. */
  v2: boolean;
}

export interface Join {
  readonly topic: string;
  replied: boolean;
  readonly reply: () => void;
}

/** Supabase Realtime as a Phoenix socket: joins every channel (at once, or when the test says), answers heartbeats, and can drop the connection. */
export class FakeRealtime {
  readonly sockets: Socket[] = [];
  readonly joins: Join[] = [];

  /** Hold the game channel's joins until the test replies, so it decides when the page hears SUBSCRIBED. */
  constructor(private readonly holdGameJoins: boolean) {}

  attach(ws: WebSocketRoute): void {
    const sock: Socket = { ws, open: true, v2: true };
    this.sockets.push(sock);
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw)) as unknown;
      const [joinRef, ref, topic, event] = Array.isArray(m)
        ? (m as [string | null, string | null, string, string])
        : [(m as { join_ref: string | null }).join_ref, (m as { ref: string | null }).ref, (m as { topic: string }).topic, (m as { event: string }).event];
      sock.v2 = Array.isArray(m);
      const reply = () => {
        if (!sock.open) return;
        const payload = { status: 'ok', response: {} };
        ws.send(JSON.stringify(sock.v2 ? [joinRef, ref, topic, 'phx_reply', payload] : { join_ref: joinRef, ref, topic, event: 'phx_reply', payload }));
      };
      if (event === 'phx_join') {
        const join: Join = {
          topic,
          replied: false,
          reply: () => {
            join.replied = true;
            reply();
          },
        };
        this.joins.push(join);
        if (!(this.holdGameJoins && topic === GAME_TOPIC)) join.reply();
      } else if (event === 'heartbeat' || event === 'access_token' || event === 'phx_leave') reply();
    });
    ws.onClose(() => (sock.open = false));
  }

  gameJoins(): Join[] {
    return this.joins.filter((j) => j.topic === GAME_TOPIC);
  }

  /** The connection drops, from the server's side: the page has to notice, reconnect and rejoin by itself. */
  async drop(): Promise<void> {
    for (const s of this.sockets.filter((x) => x.open)) {
      s.open = false;
      await s.ws.close({ code: 1001, reason: 'going away' }).catch(() => {});
    }
  }
}

export class LiveTable {
  readonly calls: Call[] = [];
  readonly pageErrors: string[] = [];
  readonly realtime: FakeRealtime;

  constructor(
    readonly page: Page,
    readonly routes: GameRoutes,
    holdGameJoins: boolean,
  ) {
    this.realtime = new FakeRealtime(holdGameJoins);
    page.on('pageerror', (e) => this.pageErrors.push(String(e)));
  }

  of(kind: Call['kind']): Call[] {
    return this.calls.filter((c) => c.kind === kind);
  }

  count(kind: Call['kind']): number {
    return this.of(kind).length;
  }

  /** Answer a request that was held. */
  async release(call: Call, reply: Answer): Promise<void> {
    await answer(call.route, reply);
  }

  /** The portrait table: the landscape one is in the page too, hidden. */
  stage(): Locator {
    return this.page.locator('.table-stage');
  }

  discard(): Locator {
    return this.stage().getByRole('button', { name: /^Discard / });
  }

  toast(): Locator {
    return this.page.locator('.toast');
  }
}

async function answer(route: Route, reply: Answer): Promise<void> {
  // A request the page has given up on can't be answered any more; that's fine.
  await route.fulfill({ status: reply.status ?? 200, contentType: 'application/json', body: JSON.stringify(reply.body) }).catch(() => {});
}

/** Nothing leaves the machine: no hCaptcha, no analytics, nothing a test could come to depend on by accident. */
export async function stayLocal(page: Page): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => route.abort());
}

/**
 * Open the game page as a seated, signed-in guest whose name is remembered.
 * `clock` installs Playwright's fake clock first, so the test can move time on.
 */
export async function openTable(page: Page, routes: GameRoutes, opts: { holdGameJoins?: boolean; clock?: boolean } = {}): Promise<LiveTable> {
  const t = new LiveTable(page, routes, opts.holdGameJoins ?? false);
  const context = page.context();
  await stayLocal(page);
  await context.addCookies([{ name: 'sb-127-auth-token', value: sessionCookie(), domain: '127.0.0.1', path: '/' }]);
  await context.addInitScript((name) => localStorage.setItem('sm:name', name), USER_NAME);

  // Supabase over HTTP, from the browser: only Auth's user endpoint means anything.
  await page.route(`${SUPABASE_URL}/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/auth/v1/user') ? guestUser() : {}) }),
  );
  await page.routeWebSocket(/127\.0\.0\.1:3499\/realtime/, (ws) => t.realtime.attach(ws));

  const log = (kind: Call['kind'], route: Route, body: ActBody | null): Call => {
    const call: Call = { kind, n: t.count(kind) + 1, body, route };
    t.calls.push(call);
    return call;
  };
  await page.route(`**/api/games/${GAME_ID}/view`, async (route) => {
    const call = log('view', route, null);
    const reply = t.routes.view(call.n);
    if (reply !== 'hold') await answer(route, reply);
  });
  await page.route(`**/api/games/${GAME_ID}/act`, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as ActBody;
    const call = log('act', route, body);
    const reply = t.routes.act ? t.routes.act(body, call.n) : { status: 500, body: { error: 'something went wrong' } };
    if (reply !== 'hold') await answer(route, reply);
  });
  await page.route(`**/api/games/${GAME_ID}/tick`, async (route) => {
    const call = log('tick', route, null);
    const reply = t.routes.view(0);
    if (reply !== 'hold') await answer(route, reply);
  });

  if (opts.clock) await page.clock.install();
  await page.goto(`/g/${GAME_ID}`);
  await expect(t.stage()).toBeVisible();
  return t;
}

/**
 * Taps `tile` until it lifts. The table ignores taps for a moment after a
 * hand starts (the grace period, which also runs on mount), and before
 * hydration nothing is listening at all, so a lifted tile is the page's own
 * word that taps count now.
 */
export async function tapUntilLifted(tile: Locator): Promise<void> {
  await expect(async () => {
    if ((await tile.getAttribute('data-selected')) !== 'true') await tile.click();
    await expect(tile).toHaveAttribute('data-selected', 'true', { timeout: 250 });
  }).toPass({ timeout: 15_000 });
}

/**
 * Waits until every request the page has made so far has reached the test.
 * Requests reach the test's routes in the order the page makes them, so once
 * a request made now has its answer, any made before it has been logged.
 */
export async function flush(page: Page): Promise<void> {
  await page.evaluate(() => fetch('/robots.txt', { cache: 'no-store' }).then((r) => r.text()));
}

/** Stops the page's clock (a moment on, so the time asked for is never already past): from here its timers fire only when the test moves time on. */
export async function pauseClock(page: Page): Promise<void> {
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 100);
}
