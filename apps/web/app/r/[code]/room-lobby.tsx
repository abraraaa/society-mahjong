'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NameGate } from '@/components/name-gate';
import { RoomWaiting } from '@/components/room-waiting';
import { Trouble, Waiting } from '@/components/trouble';
import { ApiError, api, listen, type RoomSnapshot } from '@/lib/live/client';
import { NeedsCaptcha, ensureSession, rememberName, storedName } from '@/lib/supabase/session';

const RULESET_NAMES: Record<string, string> = { karachi: 'Karachi rules', taiwanese: 'Taiwanese rules' };

/**
 * The invite link lands here. A name is all it asks; then the visitor is
 * seated, sees who else is here, and is taken to the table when the host
 * starts. Realtime carries the changes; a slow poll covers the day it does not.
 */
export function RoomLobby({ code }: { code: string }) {
  const router = useRouter();
  const [name, setName] = useState<string | null>(() => (typeof window === 'undefined' ? null : storedName()));
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const supabaseRef = useRef<SupabaseClient | null>(null);

  const goToGame = useCallback((gameId: string) => router.replace(`/g/${gameId}`), [router]);

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
        if (snap.status === 'playing' && snap.gameId) goToGame(snap.gameId);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NeedsCaptcha) setName(null);
        else setError(err instanceof Error && err.message ? `Could not join this room: ${err.message}` : 'Could not join this room.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, name, captcha, goToGame, attempt]);

  // Live seat changes and the start signal, with a poll as the fallback.
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!room || !supabase) return;
    const refresh = () =>
      api
        .room(code)
        .then((snap) => {
          setRoom(snap);
          if (snap.status === 'playing' && snap.gameId) goToGame(snap.gameId);
        })
        .catch(() => {});
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
  }, [room?.id, code, goToGame]);

  if (!name) {
    return (
      <NameGate
        title={`Room ${code}`}
        initialName={storedName() ?? ''}
        onDone={(n, token) => {
          rememberName(n);
          setCaptcha(token);
          setName(n);
        }}
      />
    );
  }

  if (!room) {
    if (error) {
      return (
        <Trouble
          message={error}
          onRetry={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        />
      );
    }
    return <Waiting>Finding your seat…</Waiting>;
  }

  const share = async () => {
    const url = `${window.location.origin}/r/${code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Mahjong?', text: `Join my table: ${code}`, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // the user dismissed the share sheet
    }
  };

  const leave = async () => {
    try {
      await api.leaveRoom(code);
    } catch {
      // not seated, or the table already started: either way, home is right
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
      setError(err instanceof ApiError ? err.message : 'Could not start.');
      setStarting(false);
    }
  };

  return (
    <RoomWaiting
      code={code}
      seats={room.seats}
      me={room.me}
      ruleset={RULESET_NAMES[room.rulesetId] ?? room.rulesetId}
      isHost={room.isHost}
      onLeave={leave}
      starting={starting}
      error={error}
      onStart={start}
      onShare={share}
    />
  );
}
