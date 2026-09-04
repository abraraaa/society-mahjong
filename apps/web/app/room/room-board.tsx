'use client';
import { useRouter } from 'next/navigation';
import { RoomWaiting, type RoomSeat } from '@/components/room-waiting';

const SEATS: readonly RoomSeat[] = [
  { wind: 'E', name: 'You', note: 'host', filled: true },
  { wind: 'S', name: 'Waiting…', note: '', filled: false },
  { wind: 'W', name: 'Waiting…', note: '', filled: false },
  { wind: 'N', name: 'Waiting…', note: '', filled: false },
];

export function RoomBoard({ code }: { code: string }) {
  const router = useRouter();
  return <RoomWaiting code={code} seats={SEATS} ruleset="Karachi rules" goulash={false} tutor onFillWithBots={() => router.push('/play/solo')} />;
}
