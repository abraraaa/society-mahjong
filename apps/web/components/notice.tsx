'use client';
import { useEffect } from 'react';

/**
 * A line at the top of the table that says why a tap did nothing: the window
 * had closed, the table had moved on, the request did not get through. It
 * goes away by itself; the table below it is the real answer.
 */
export function Notice({ text, onDone, ms = 4500 }: { text: string | null; onDone: () => void; ms?: number }) {
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [text, onDone, ms]);
  if (!text) return null;
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}
