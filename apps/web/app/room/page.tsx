import type { Metadata } from 'next';
import { CreateRoom } from './create-room';

export const dynamic = 'force-dynamic';
/** A lobby is for the person hosting, not for search. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function RoomPage() {
  return <CreateRoom />;
}
