'use client';
import { useEffect, useState } from 'react';
import type { WatchOffer } from '@/components/table';
import { WATCH_LINE, watchHeading } from '../coach/stage';
import { ApiError, api } from './client';
import { plainError } from './plain';

/**
 * The tutor's offer to just watch at a live table, asked once a hand: `hand`
 * names the finished hand the result sheet is showing (null while there isn't
 * one, or it isn't the reader's to answer). The server tallies a hand before
 * it answers the move that ended it, so asking when the sheet comes up sees
 * that hand's win. A failed read says nothing: the next hand asks again.
 */
export function useWatchOffer(hand: string | null): WatchOffer | null {
  const [asked, setAsked] = useState<{ readonly hand: string; readonly wins: number } | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hand === null) return;
    let live = true;
    api.watchOffer().then(
      (r) => {
        if (live && r.ask) setAsked({ hand, wins: r.wins });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [hand]);

  if (hand === null || asked?.hand !== hand || answered === hand) return null;
  return {
    heading: watchHeading(asked.wins),
    line: WATCH_LINE.live,
    busy,
    error,
    onAnswer: (watch) => {
      setBusy(true);
      setError(null);
      api.answerWatch(watch).then(
        () => setAnswered(hand),
        (err: unknown) => {
          // Answered already, on another phone or tab: there's nothing left to ask.
          if (err instanceof ApiError && err.status === 409) setAnswered(hand);
          else setError(plainError(err));
        },
      ).finally(() => setBusy(false));
    },
  };
}
