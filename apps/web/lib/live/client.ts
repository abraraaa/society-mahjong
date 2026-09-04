'use client';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, credentials: 'same-origin' });
  const body = (await res.json().catch(() => ({}))) as { error?: string; snapshot?: GameSnapshot } & T;
  // Safari leaves statusText empty over HTTP/2, so a non-JSON failure still names its status.
  if (!res.ok) throw new ApiError(res.status, body.error ?? (res.statusText || `the server answered ${res.status}`), body.snapshot);
  return body;
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

/** Subscribe to a private broadcast topic. Returns the unsubscribe. */
export function listen(supabase: SupabaseClient, topic: string, handlers: Record<string, (payload: Record<string, unknown>) => void>): () => void {
  let channel: RealtimeChannel | null = supabase.channel(topic, { config: { private: true } });
  for (const [event, fn] of Object.entries(handlers)) channel.on('broadcast', { event }, (msg) => fn((msg.payload ?? {}) as Record<string, unknown>));
  void supabase.realtime.setAuth().then(() => channel?.subscribe());
  return () => {
    if (channel) void supabase.removeChannel(channel);
    channel = null;
  };
}
