import { isRoomCode } from './room-code';
import { seatOf, type RoomStatus, type Seats } from './live/types';

/** How long a room keeps taking newcomers once it has gone quiet: six weeks with no write to the room and nobody seen there. */
export const ROOM_OPEN_MS = 42 * 24 * 60 * 60 * 1000;

/** What an invite link shows first: the lobby (name gate, then a seat), or a table that isn't there. */
export type FrontDoor = 'lobby' | 'no-table' | 'closed';

/** The parts of a room row the front door reads. */
export interface DoorRoom {
  readonly id: string;
  readonly status: RoomStatus;
  readonly updated_at: string;
  readonly seats: Seats;
}

/**
 * Whether a room has stopped taking newcomers (R24): it isn't playing, and
 * it has been quiet for ROOM_OPEN_MS, counting from the later of its last
 * write (`updated_at`: seats, a start, an end) and the last time any member
 * was seen there (`lastSeenAt`, from room_members; null when unknown or
 * nobody). The one rule for it: the front door and the join
 * (lib/live/rooms.ts) both ask this, and both still let the room's own people
 * in.
 */
export function isClosedRoom(room: Pick<DoorRoom, 'status' | 'updated_at'>, now: number, lastSeenAt: number | null = null): boolean {
  if (room.status === 'playing') return false;
  const written = Date.parse(room.updated_at);
  const quietSince = Math.max(Number.isNaN(written) ? Number.NEGATIVE_INFINITY : written, lastSeenAt ?? Number.NEGATIVE_INFINITY);
  return now - quietSince > ROOM_OPEN_MS;
}

/** How the front door looks things up: passed in, so the rules are tested without a database. */
export interface DoorLookup {
  /** False when the server has no database settings: nothing can be checked, so the lobby behaves as it always has. */
  readonly configured: boolean;
  readonly room: (code: string) => Promise<DoorRoom | null>;
  /** Everyone who has sat at the room and when each was last seen there. Only asked about a room its writes say is closed. */
  readonly members: (roomId: string) => Promise<readonly { readonly userId: string; readonly lastSeenAt: number }[]>;
  /** The visitor's user id from their session, or null when they have none. Only asked about a closed room. */
  readonly userId: () => Promise<string | null>;
}

/**
 * Where an invite link leads, decided before anyone is asked for a name or
 * shown a captcha. A code this app could never have issued, or one with no
 * room behind it, is no table. A room that has been quiet for six weeks is
 * closed to newcomers, but its own people (anyone seated there, or who ever
 * has been) still get back in, as they do at the join, and their check-in
 * opens it again. If the check can't be made (no settings, or a lookup that
 * throws), the lobby goes ahead as before and the join has the final say.
 */
export async function frontDoor(code: string, look: DoorLookup, now = Date.now()): Promise<FrontDoor> {
  if (!isRoomCode(code)) return 'no-table';
  if (!look.configured) return 'lobby';
  try {
    const room = await look.room(code);
    if (!room) return 'no-table';
    if (!isClosedRoom(room, now)) return 'lobby';
    // Quiet by its own writes; someone seen there lately keeps it open all the same.
    const members = await look.members(room.id);
    const lastSeen = members.reduce<number | null>((at, m) => (at === null || m.lastSeenAt > at ? m.lastSeenAt : at), null);
    if (!isClosedRoom(room, now, lastSeen)) return 'lobby';
    const userId = await look.userId();
    if (userId === null) return 'closed';
    return seatOf(room.seats, userId) !== null || members.some((m) => m.userId === userId) ? 'lobby' : 'closed';
  } catch {
    return 'lobby';
  }
}

/**
 * Whether Try again could help after a table failed to load. A code with no
 * room behind it (404), a table that has closed (410), or a game the visitor
 * has no seat in (403) stays that way, so the way out is home, not another go.
 */
export function retryCanHelp(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status !== 403 && status !== 404 && status !== 410;
}
