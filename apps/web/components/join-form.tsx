'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** "I have a code": four characters after the prefix, straight to the lobby. */
export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const clean = code.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (clean.length >= 4) router.push(`/r/${clean.includes('-') ? clean : `KHI-${clean}`}`);
      }}
    >
      <input
        className="min-w-0 flex-1 rounded-2xl bg-felt-800/60 px-4 py-3 text-base tracking-[0.12em] text-ivory-50 uppercase outline-none ring-ivory-50/30 focus:ring-2"
        placeholder="KHI-4287"
        autoCapitalize="characters"
        autoCorrect="off"
        maxLength={8}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button className="btn btn-ghost" type="submit" disabled={clean.length < 4}>
        Join
      </button>
    </form>
  );
}
