'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** "I have a code": five characters after the prefix (older rooms had four), straight to the lobby. */
export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  // "KHI-4287Q", "KHI 4287Q", "khi4287q" and "4287Q" all mean the same room.
  const bare = code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^KHI/, '');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (bare.length >= 4) router.push(`/r/KHI-${bare}`);
      }}
    >
      <input
        className="min-w-0 flex-1 rounded-2xl bg-felt-800/60 px-4 py-3 text-base tracking-[0.12em] text-ivory-50 uppercase outline-none placeholder:tracking-normal placeholder:normal-case placeholder:text-ivory-200/50 ring-ivory-50/30 focus:ring-2"
        placeholder="Got a code?"
        aria-label="Table code"
        autoCapitalize="characters"
        autoCorrect="off"
        maxLength={10}
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button className="btn btn-ghost" type="submit" disabled={bare.length < 4}>
        Join
      </button>
    </form>
  );
}
