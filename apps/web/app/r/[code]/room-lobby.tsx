'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NameGate } from '@/components/name-gate';
import { RoomWaiting } from '@/components/room-waiting';
import { TakeSeat } from '@/components/take-seat';
import { Trouble, Waiting } from '@/components/trouble';
import { retryCanHelp } from '@/lib/front-door';
import { ApiError, api, listen, type RoomSnapshot } from '@/lib/live/client';
import { joinRetryLabel, joinTroubleTitle, plainError } from '@/lib/live/plain';
import { NeedsCaptcha, ensureSession } from '@/lib/supabase/session';
import { useGuestName } from '@/lib/supabase/use-guest-name';

const RULESET_NAMES: Record<string, string> = { karachi: 'Karachi rules', taiwanese: 'Taiwanese rules' };

/**
 * The invite link lands here. A name is all it asks; then the visitor is
 * seated, sees who else is here, and is taken to the table when the host
 * starts. Realtime carries the changes; a slow poll covers the day it does not.
 * Someone arriving once the game has started is offered a bot's seat to take
 * over instead (their own, if a bot is keeping it), and goes to the table once
 * they've taken it.
 */
export function RoomLobby({ code }: { code: string }) {
  const router = useRouter();
  const { name, initialName, choose, askAgain } = useGuestName();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A code with no table behind it, or a closed table: Try again can't change that.
  const [deadEnd, setDeadEnd] = useState(false);
  // A game under way or a full table: the button checks again rather than promising another go will work.
  const [retryLabel, setRetryLabel] = useState('Try again');
  // The heading over it, when "That didn't work." would be wrong (they got up on another phone or tab).
  const [troubleTitle, setTroubleTitle] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  // The link went to the clipboard, on a phone with no share sheet: the button says so.
  const [copied, setCopied] = useState(false);
  // Taking a bot's seat over is on its way, and why it didn't work if it didn't.
  const [taking, setTaking] = useState(false);
  const [takeError, setTakeError] = useState<string | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  // Standing up from the lobby: a poll that lands meanwhile finds them unseated, and mustn't sit them down again.
  const leavingRef = useRef(false);

  const goToGame = useCallback((gameId: string) => router.replace(`/g/${gameId}`), [router]);
  // A join that didn't work: why, whether another go can help, and what its button says.
  const failJoin = useCallback((err: unknown) => {
    setRoom(null);
    setError(plainError(err));
    setDeadEnd(!retryCanHelp(err));
    setRetryLabel(joinRetryLabel(err));
    setTroubleTitle(joinTroubleTitle(err));
  }, []);

  // Join once we have a name.
  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await ensureSession(name, captcha);
        supabaseRef.current = supabase;
        const snap = await api.join(code, name);
        if (cancelled) return;
        setRoom(snap);
        // Only someone with a seat goes to the table; anyone else is offered one first.
        if (snap.status === 'playing' && snap.gameId && snap.me !== null) goToGame(snap.gameId);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NeedsCaptcha) askAgain();
        else failJoin(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, name, captcha, goToGame, attempt, askAgain, failJoin]);

  // Live seat changes and the start signal, with a poll as the fallback: for someone seated. Someone looking at a seat to take
  // over has nothing to wait for, and the lobby's poll is for its own people.
  // Someone found without a seat between games is asked about once, by the server, which knows why (joinRoom's rejoin). If a
  // newcomer was given their seat (their join read them as not here a moment before their check-in landed), they're sat down in
  // a free seat or a bot's, else shown the full line and a way to check again, which is opening the link. If they got up, on
  // another phone or tab, or in a Leave that crossed this ask, it stays that way: "You've left this table", and a way to sit back
  // down. The poll says they're unseated with a refusal (not at this table) or, for the host, a lobby without them.
  const seated = room !== null && room.me !== null;
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!room || !supabase || !seated || !name) return;
    let rejoining = false;
    const rejoin = () => {
      if (rejoining || leavingRef.current) return;
      rejoining = true;
      api
        .join(code, name, true)
        .then((snap) => {
          // Leave was tapped here meanwhile: that's the answer, whatever this one says.
          if (leavingRef.current) return;
          setRoom(snap);
          if (snap.status === 'playing' && snap.gameId && snap.me !== null) goToGame(snap.gameId);
        })
        .catch((e: unknown) => {
          if (!leavingRef.current) failJoin(e);
        })
        .finally(() => {
          rejoining = false;
        });
    };
    const refresh = () =>
      api
        .room(code)
        .then((snap) => {
          if (snap.me === null && snap.status !== 'playing') return rejoin();
          setRoom(snap);
          if (snap.status === 'playing' && snap.gameId) goToGame(snap.gameId);
        })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 403) rejoin();
        });
    const stop = listen(supabase, `room:${room.id}`, {
      seats: () => refresh(),
      started: (p) => (typeof p['gameId'] === 'string' ? goToGame(p['gameId']) : refresh()),
    });
    const poll = setInterval(refresh, 5000);
    return () => {
      stop();
      clearInterval(poll);
    };
    // room.id is stable once set; re-subscribing on every seat change would drop messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, seated, code, name, goToGame, failJoin]);

  if (!name) {
    return (
      <NameGate
        title={`Table ${code}`}
        initialName={initialName}
        onDone={(n, token) => {
          setCaptcha(token);
          choose(n);
        }}
      />
    );
  }

  if (!room) {
    if (error) {
      return (
        <Trouble
          {...(troubleTitle ? { title: troubleTitle } : {})}
          message={error}
          retryLabel={retryLabel}
          onRetry={
            deadEnd
              ? undefined
              : () => {
                  setError(null);
                  setTroubleTitle(undefined);
                  // A captcha token is spent once it's been tried; with no session yet, a retry goes back to the gate for a fresh one.
                  setCaptcha(null);
                  setAttempt((n) => n + 1);
                }
          }
        />
      );
    }
    return <Waiting>Finding your seat…</Waiting>;
  }

  // Not seated at a game in play: a bot's seat to take over. Once it's theirs, off to the table; if the game ended meanwhile the
  // answer is the room, between games. If it didn't work, a fresh look at the room for another seat, or none.
  if (room.me === null && room.offer) {
    const offer = room.offer;
    const takeOver = async () => {
      setTaking(true);
      setTakeError(null);
      try {
        const snap = await api.sit(code, offer.seat, name);
        if (snap.status === 'playing' && snap.me !== null && snap.gameId) goToGame(snap.gameId);
        else {
          setRoom(snap);
          setTaking(false);
        }
      } catch (err) {
        setTakeError(plainError(err));
        setTaking(false);
        api.join(code, name).then(setRoom).catch(failJoin);
      }
    };
    return <TakeSeat offer={offer} busy={taking} error={takeError} onTake={() => void takeOver()} />;
  }

  const share = async () => {
    const url = `${window.location.origin}/r/${code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Mahjong?', text: `Join my table: ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      // the user dismissed the share sheet
    }
  };

  const leave = async () => {
    leavingRef.current = true;
    try {
      await api.leaveRoom(code);
    } catch {
      // not seated, or a game started meanwhile: either way, home is right
    }
    router.replace('/');
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const { gameId } = await api.start(code);
      goToGame(gameId);
    } catch (err) {
      setError(plainError(err));
      setStarting(false);
      // "the seats changed": the seats moved while the host was dealing; show them as they are now.
      api
        .room(code)
        .then(setRoom)
        .catch(() => {});
    }
  };

  return (
    <RoomWaiting
      room={room}
      ruleset={RULESET_NAMES[room.rulesetId] ?? room.rulesetId}
      onLeave={leave}
      starting={starting}
      error={error}
      copied={copied}
      onStart={start}
      onShare={share}
    />
  );
}
