'use client';
import { useState } from 'react';

/** The one question a guest is asked. */
export function NameGate({ title, onDone }: { title: string; onDone: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div className="space-y-2">
        <p className="eyebrow">{title}</p>
        <h1 className="font-display text-3xl">What should the table call you?</h1>
        <p className="text-ivory-200/70 text-sm">No account needed. You can add an email later to keep your history.</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n) onDone(n.slice(0, 24));
        }}
      >
        <input
          autoFocus
          className="rounded-2xl bg-felt-800/60 px-4 py-3 text-lg text-ivory-50 outline-none ring-ivory-50/30 focus:ring-2"
          placeholder="Your name"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-primary btn-block min-h-[52px] text-[18px]" disabled={!name.trim()} type="submit">
          Sit down
        </button>
      </form>
    </main>
  );
}
