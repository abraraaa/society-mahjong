import { RoomBoard } from './room-board';
import { generateRoomCode } from '@/lib/room-code';

/** A room code must be fresh per visit, so this route can't be prerendered. */
export const dynamic = 'force-dynamic';

export default function RoomPage() {
  // Minted on the server: a code generated in the browser would either
  // mismatch the HTML it hydrates or have to arrive a frame late.
  return <RoomBoard code={generateRoomCode()} />;
}
