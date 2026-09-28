'use client';
import { useCallback, useSyncExternalStore } from 'react';

/** Where the phone remembers whether the tutor is on: 'on' or 'off'; anything else reads as on. */
export const TUTOR_KEY = 'sm:tutor';

// Kept in memory as well as storage: in a private window storage can refuse
// it, and the toggle still holds for the rest of the visit.
let memory: boolean | null = null;
const listeners = new Set<() => void>();

/** Whether the tutor is on for this phone: memory first, then storage; on by default. */
export function readTutorOn(): boolean {
  if (memory !== null) return memory;
  try {
    memory = globalThis.localStorage?.getItem(TUTOR_KEY) !== 'off';
  } catch {
    memory = true;
  }
  return memory;
}

/** Remember the tutor on or off, and tell every table on the page. */
export function saveTutorOn(on: boolean): void {
  memory = on;
  try {
    globalThis.localStorage?.setItem(TUTOR_KEY, on ? 'on' : 'off');
  } catch {
    // storage refused (private mode, full): memory still holds it
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The tutor toggle, remembered per phone. The server renders it on, and the
 * first render in the browser matches that before reading storage, so a
 * phone that turned it off never hydrates into a mismatch.
 */
export function useTutorOn(): readonly [on: boolean, toggle: () => void] {
  const on = useSyncExternalStore(subscribe, readTutorOn, () => true);
  const toggle = useCallback(() => saveTutorOn(!readTutorOn()), []);
  return [on, toggle] as const;
}
