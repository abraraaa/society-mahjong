'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { RoomWaiting, type RoomSeat } from '@/components/room-waiting';
import { generateRoomCode } from '@/lib/room-code';

const SEATS: readonly RoomSeat[] = [
  { wind: 'E', name: 'You', note: 'host', filled: true },
  { wind: 'S', name: 'Waiting…', note: '', filled: false },
  { wind: 'W', name: 'Waiting…', note: '', filled: false },
  { wind: 'N', name: 'Waiting…', note: '', filled: false },
];

export default function RoomPage() {
  const router = useRouter();
  // Generated client-side only: a random code in the initial state would mismatch
  // the server-rendered HTML during hydration.
  const [code, setCode] = useState('');
  useEffect(() => setCode(generateRoomCode()), []);

  return (
    <RoomWaiting
      code={code || '————————'}
      seats={SEATS}
      ruleset="Karachi rules"
      goulash={false}
      tutor
      onFillWithBots={() => router.push('/play/solo')}
    />
  );
}
