import 'server-only';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { supabaseServiceKey, supabaseUrl } from '../supabase/env';

export interface BroadcastMessage {
  readonly topic: string;
  readonly event: string;
  readonly payload: unknown;
  readonly private?: boolean;
}

/**
 * Send Realtime Broadcast messages over HTTP from the server. No socket: the
 * route handler posts and moves on. Channels are private and authorised by the
 * `realtime.messages` policy in migration 0002.
 *
 * Best-effort, and never throws: by the time anyone is poked the move is
 * already saved, so a failed poke is logged rather than turned into a 500
 * for a move that landed.
 */
export async function broadcast(messages: readonly BroadcastMessage[]): Promise<void> {
  if (messages.length === 0) return;
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.map((m) => ({ ...m, private: m.private ?? true })) }),
    });
    if (!res.ok) console.error('broadcast failed', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error('broadcast failed', err instanceof Error ? err.message : err);
  }
}

/** Everyone at the table learns the version moved; they refetch their own view. */
export function gamePoke(gameId: string, version: number, extra: Record<string, unknown> = {}): BroadcastMessage {
  return { topic: `game:${gameId}`, event: 'state', payload: { version, ...extra } };
}

export function roomPoke(roomId: string, event: 'seats' | 'started', payload: Record<string, unknown>): BroadcastMessage {
  return { topic: `room:${roomId}`, event, payload };
}
