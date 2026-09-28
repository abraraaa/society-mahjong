import 'server-only';
import type { CoachStage } from '../coach/types';
// Relative rather than '@/': vitest runs without the path alias, and the tests load this.
import { createServiceClient } from '../supabase/service';
import { SupabaseError } from './errors';
import { logError } from './log';
import type { GameOver } from './table-state';
import type { Seats } from './types';

/**
 * The funnel's moments, one app_events row each (docs/ops/funnel.sql, query
 * 9): a room made, a seat taken, a game dealt, and a game finished or
 * abandoned. They're for the owner's numbers, never for a player, so writing
 * one is best-effort: a failure is logged and the request it belongs to goes
 * on as if it had worked.
 */
export const EVENT_TYPES = ['room_made', 'seat_taken', 'game_dealt', 'game_finished', 'game_abandoned'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface AppEvent {
  readonly type: EventType;
  readonly roomId?: string;
  readonly gameId?: string;
  /** who did it: the host, who sat, the starter, who ended the game, the last to leave; null when nobody did (an idle end) */
  readonly userId?: string | null;
  /** what's particular to this type (docs/DATA-MODEL.md, app_events.data) */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Count one moment for the funnel. Best-effort: a failed write is logged as event_write_failed and never thrown. */
export async function recordEvent(e: AppEvent): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from('app_events')
      .insert({ type: e.type, room_id: e.roomId ?? null, game_id: e.gameId ?? null, user_id: e.userId ?? null, data: e.data ?? {} });
    if (error) throw new SupabaseError('count the moment', error);
  } catch (err) {
    // Which moment, and where: never who, so no one's id reaches the logs from here.
    logError('event_write_failed', err, { type: e.type, roomId: e.roomId, gameId: e.gameId });
  }
}

/** How many of the seats are people, and how many bots. */
function kinds(seats: Seats): { humans: number; bots: number } {
  const humans = seats.filter((s) => s?.kind === 'human').length;
  return { humans, bots: seats.filter((s) => s?.kind === 'bot').length };
}

/**
 * A deal, as the funnel counts it: who sat down to it (people and bots), how
 * far along the people were (stagesBySeat, one per seat, null for a bot), and
 * whether the room had dealt a game before.
 */
export function gameDealt(e: { roomId: string; gameId: string; userId: string; seats: Seats; levels: readonly (CoachStage | null)[]; again: boolean }): AppEvent {
  const levels: Record<CoachStage, number> = { new: 0, first_hand: 0, learning: 0, solid: 0 };
  e.seats.forEach((s, seat) => {
    if (s?.kind === 'human') levels[e.levels[seat] ?? 'new'] += 1;
  });
  return { type: 'game_dealt', roomId: e.roomId, gameId: e.gameId, userId: e.userId, data: { ...kinds(e.seats), again: e.again, levels } };
}

/**
 * A game's end, as the funnel counts it: finished (played out, ended by the
 * host, or idle), by whoever ended it; or abandoned, by the last person to
 * leave (`leaver`). Only the request that ended the game counts it, never a
 * later one that finishes its record, so each end is counted once.
 */
export function gameEnded(e: { roomId: string; gameId: string; over: GameOver; leaver: string | null }): AppEvent {
  const { over } = e;
  if (over.how === 'abandoned') return { type: 'game_abandoned', roomId: e.roomId, gameId: e.gameId, userId: e.leaver, data: { hands: over.hands } };
  return {
    type: 'game_finished',
    roomId: e.roomId,
    gameId: e.gameId,
    userId: over.by?.userId ?? null,
    data: { how: over.how, hands: over.hands, humans: kinds(over.seats).humans },
  };
}
