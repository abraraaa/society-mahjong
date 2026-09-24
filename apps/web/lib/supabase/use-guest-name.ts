'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { rememberName, storedName } from './session';

/** What the guest has done on this page: nothing yet, answered the gate, or been sent back to it. */
export type NamePick = { readonly name: string | null } | null;

/** The name a page sits down with: the gate's answer if there has been one, otherwise the remembered name. */
export function currentName(stored: string | null, pick: NamePick): string | null {
  return pick ? pick.name : stored;
}

// The name only changes through `choose` below, which keeps its own copy, so there is nothing to listen to.
// Another tab renaming itself doesn't move this one mid-game.
const noSubscription = () => () => {};
const onTheServer = () => null;

/**
 * The guest's name for the host, lobby and table pages, shared so they all read
 * it the same way.
 *
 * The remembered name lives in localStorage, which the server doesn't have, so
 * the server renders the name gate. The first render in the browser has to
 * match that or React throws the page away (error #418), so the stored name is
 * read only once hydration is done; a client-side visit reads it at once.
 *
 * `name` is null while the gate should show: nothing remembered, not yet read,
 * or the session has lapsed and `askAgain` sent the guest back to it.
 * `initialName` fills the gate with the remembered name.
 */
export function useGuestName(): { name: string | null; initialName: string; choose: (name: string) => void; askAgain: () => void } {
  const stored = useSyncExternalStore(noSubscription, storedName, onTheServer);
  const [pick, setPick] = useState<NamePick>(null);
  // The gate's answer is kept here as well as in storage: in a private window
  // storage can refuse it, and the guest still gets to sit down.
  const choose = useCallback((name: string) => {
    rememberName(name);
    setPick({ name });
  }, []);
  const askAgain = useCallback(() => setPick({ name: null }), []);
  return { name: currentName(stored, pick), initialName: stored ?? '', choose, askAgain };
}
