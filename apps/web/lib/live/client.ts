'use client';
import type { REALTIME_SUBSCRIBE_STATES, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { GameSnapshot } from './snapshot';
import type { ClientAction } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly snapshot?: GameSnapshot,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * How long a request may go unanswered before the page stops waiting. A phone
 * that has just moved from Wi-Fi to 4G can leave a request hanging long after
 * the connection it went out on has gone; ten seconds is already a long wait at
 * a table, and leaves time to look again before a turn clock runs out.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/** What a request that got no answer in time rejects with: no HTTP status, since none arrived. */
export const TIMEOUT_MESSAGE = 'timed out';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, credentials: 'same-origin', signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as { error?: string; snapshot?: GameSnapshot } & T;
    // A body cut off by the timeout reads as {} above; it is no answer, not an empty one.
    if (controller.signal.aborted) throw new ApiError(0, TIMEOUT_MESSAGE);
    // Safari leaves statusText empty over HTTP/2, so a non-JSON failure still names its status.
    if (!res.ok) throw new ApiError(res.status, body.error ?? (res.statusText || `the server answered ${res.status}`), body.snapshot);
    return body;
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof ApiError)) throw new ApiError(0, TIMEOUT_MESSAGE);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RoomSnapshot {
  readonly id: string;
  readonly code: string;
  readonly rulesetId: string;
  readonly status: 'lobby' | 'playing' | 'finished';
  readonly seats: readonly ({ readonly kind: 'human' | 'bot'; readonly name: string } | null)[];
  readonly me: number | null;
  readonly isHost: boolean;
  readonly gameId: string | null;
}

export const api = {
  createRoom: (rulesetId = 'karachi') => call<{ id: string; code: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ rulesetId }) }),
  room: (code: string) => call<RoomSnapshot>(`/api/rooms/${encodeURIComponent(code)}`),
  join: (code: string, name: string) => call<RoomSnapshot>(`/api/rooms/${encodeURIComponent(code)}/join`, { method: 'POST', body: JSON.stringify({ name }) }),
  start: (code: string) => call<{ gameId: string }>(`/api/rooms/${encodeURIComponent(code)}/start`, { method: 'POST' }),
  view: (gameId: string) => call<GameSnapshot>(`/api/games/${gameId}/view`),
  act: (gameId: string, action: ClientAction, expectedVersion: number) =>
    call<GameSnapshot>(`/api/games/${gameId}/act`, { method: 'POST', body: JSON.stringify({ action, expectedVersion }) }),
  tick: (gameId: string) => call<GameSnapshot>(`/api/games/${gameId}/tick`, { method: 'POST' }),
  leave: (gameId: string) => call<{ abandoned: boolean }>(`/api/games/${gameId}/leave`, { method: 'POST' }),
  leaveRoom: (code: string) => call<RoomSnapshot>(`/api/rooms/${encodeURIComponent(code)}/leave`, { method: 'POST' }),
};

/** The channel's own news: SUBSCRIBED each time it joins, including every rejoin after a dropped connection, and CLOSED, TIMED_OUT or CHANNEL_ERROR when it goes. */
export type ChannelStatus = `${REALTIME_SUBSCRIBE_STATES}`;

/**
 * Subscribe to a private broadcast topic. Returns the unsubscribe. `onStatus`
 * hears every change in the channel's state; a page that must not miss a poke
 * looks again on each SUBSCRIBED, since pokes sent while it was away are gone.
 */
export function listen(
  supabase: SupabaseClient,
  topic: string,
  handlers: Record<string, (payload: Record<string, unknown>) => void>,
  onStatus?: (status: ChannelStatus) => void,
): () => void {
  let channel: RealtimeChannel | null = supabase.channel(topic, { config: { private: true } });
  for (const [event, fn] of Object.entries(handlers)) channel.on('broadcast', { event }, (msg) => fn((msg.payload ?? {}) as Record<string, unknown>));
  void supabase.realtime.setAuth().then(() => channel?.subscribe(onStatus && ((status) => channel && onStatus(status))));
  return () => {
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };
}
