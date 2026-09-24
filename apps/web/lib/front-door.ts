import { isRoomCode } from './room-code';
import { seatOf, type RoomStatus, type Seats } from './live/types';

/**
 * How long a finished room keeps taking newcomers: a week after its last game.
 * Joining enforces this as STALE_ROOM_MS in lib/live/rooms.ts, which doesn't
 * export it, so the two must change together.
 */
export const ROOM_OPEN_MS = 7 * 24 * 60 * 60 * 1000;

/** What an invite link shows first: the lobby (name gate, then a seat), or a table that isn't there. */
export type FrontDoor = 'lobby' | 'no-table' | 'closed';

/** The parts of a room row the front door reads. */
export interface DoorRoom {
  readonly status: RoomStatus;
  readonly updated_at: string;
  readonly seats: Seats;
}

/** Whether a room has stopped taking newcomers, by the same rule the join follows. */
export function isClosedRoom(room: Pick<DoorRoom, 'status' | 'updated_at'>, now: number): boolean {
  return room.status === 'finished' && now - Date.parse(room.updated_at) > ROOM_OPEN_MS;
}

/** How the front door looks things up: passed in, so the rules are tested without a database. */
export interface DoorLookup {
  /** False when the server has no database settings: nothing can be checked, so the lobby behaves as it always has. */
  readonly configured: boolean;
  readonly room: (code: string) => Promise<DoorRoom | null>;
  /** The visitor's user id from their session, or null when they have none. Only asked about a closed room. */
  readonly userId: () => Promise<string | null>;
}

/**
 * Where an invite link leads, decided before anyone is asked for a name or
 * shown a captcha. A code this app could never have issued, or one with no
 * room behind it, is no table. A room a week past its last game is closed to
 * newcomers, but its own people still get back in, as they do at the join. If
 * the check can't be made (no settings, or a lookup that throws), the lobby
 * goes ahead as before and the join has the final say.
 */
export async function frontDoor(code: string, look: DoorLookup, now = Date.now()): Promise<FrontDoor> {
  if (!isRoomCode(code)) return 'no-table';
  if (!look.configured) return 'lobby';
  try {
    const room = await look.room(code);
    if (!room) return 'no-table';
    if (!isClosedRoom(room, now)) return 'lobby';
    const userId = await look.userId();
    return userId !== null && seatOf(room.seats, userId) !== null ? 'lobby' : 'closed';
  } catch {
    return 'lobby';
  }
}

/**
 * Whether Try again could help after a table failed to load. A code with no
 * room behind it (404) or a table that has closed (410) stays that way, so the
 * way out is home, not another go.
 */
export function retryCanHelp(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status !== 404 && status !== 410;
}
