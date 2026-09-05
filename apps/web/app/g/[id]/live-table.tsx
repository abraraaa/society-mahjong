'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRuleset, tileName, type Action, type Seat } from '@society/engine';
import { Table } from '@/components/table';
import { NameGate } from '@/components/name-gate';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { Notice } from '@/components/notice';
import { Trouble, Waiting } from '@/components/trouble';
import { analyseFor, coachFor, stageFor, type CoachState } from '@/lib/coach';
import { ApiError, api, listen } from '@/lib/live/client';
import { isPrivate, type GameSnapshot } from '@/lib/live/snapshot';
import type { ClientAction } from '@/lib/live/types';
import { NeedsCaptcha, ensureSession, rememberName, storedName } from '@/lib/supabase/session';
import { scoresFrom } from '@/lib/ledger';

interface Progress {
  readonly handsFinished: number;
  readonly wins: number;
  readonly discardsMade: number;
}

/**
 * A seat at a live table. The server is the table; this component holds the
 * latest snapshot it was given, sends actions with the version it saw, and
 * refetches whenever the game channel says the version moved.
 */
export function LiveTable({ gameId }: { gameId: string }) {
  const router = useRouter();
  const [name, setName] = useState<string | null>(() => (typeof window === 'undefined' ? null : storedName()));
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Why the last tap did nothing, shown over the table for a moment.
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [leaving, setLeaving] = useState<'asking' | 'going' | null>(null);
  const [tutorOn, setTutorOn] = useState(true);
  const [progress, setProgress] = useState<Progress>({ handsFinished: 0, wins: 0, discardsMade: 0 });
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const versionRef = useRef(0);

  // How long the claim window had left when this snapshot was made, measured on
  // the server's clock so the phone's clock never enters into it.
  const [claimMs, setClaimMs] = useState<number | null>(null);
  // The server's clock at the moment the snapshot arrived, against the phone's,
  // so the countdown is drawn in server time and a wrong phone clock cannot
  // show a deadline that the table does not have.
  const [sync, setSync] = useState<{ serverNow: number; at: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const take = useCallback((s: GameSnapshot) => {
    if (s.version < versionRef.current) return; // an older reply arriving late
    versionRef.current = s.version;
    setClaimMs(s.deadlines.claim === null ? null : s.deadlines.claim - s.now);
    const at = Date.now();
    setSync({ serverNow: s.now, at });
    setNow(at);
    setSnap(s);
  }, []);

  // A once-a-second tick while any clock is running, for the countdown.
  const running = !!snap && (snap.deadlines.turn !== null || snap.deadlines.claim !== null);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const refetch = useCallback(async () => {
    try {
      take(await api.view(gameId));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Lost the table.';
      setError(msg);
      setNotice(msg);
    }
  }, [gameId, take]);

  // Session, first view, subscription.
  useEffect(() => {
    if (!name) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { supabase } = await ensureSession(name, captcha);
        if (cancelled) return;
        supabaseRef.current = supabase;
        await refetch();
        stop = listen(supabase, `game:${gameId}`, {
          state: (p) => {
            if (typeof p['version'] !== 'number' || p['version'] > versionRef.current) void refetch();
          },
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NeedsCaptcha) setName(null);
        else setError(err instanceof Error && err.message ? `Could not sit down: ${err.message}` : 'Could not sit down.');
      }
    })();
    const onVisible = () => document.visibilityState === 'visible' && void refetch();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      stop?.();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [name, captcha, gameId, refetch, attempt]);

  // When a deadline passes and the table has not moved, ask it to resolve the clock.
  useEffect(() => {
    if (!snap) return;
    const due = [snap.deadlines.claim, snap.deadlines.turn].filter((d): d is number => d !== null);
    if (due.length === 0) return;
    const skew = Date.now() - snap.now; // client clock minus server clock, roughly
    // A clock that has already run out (a phone waking up) is resolved at once,
    // so the stale table is on screen for as short a time as possible.
    const wait = Math.max(0, Math.min(...due) + skew - Date.now() + 750);
    const t = setTimeout(
      () =>
        api
          .tick(gameId)
          .then((s) => {
            take(s);
            const mine = s.standIns?.find((x) => x.seat === s.me);
            if (mine) setNotice(standInText(mine.action));
          })
          .catch(() => refetch()),
      wait,
    );
    return () => clearTimeout(t);
  }, [snap, gameId, take, refetch]);

  const ruleset = useMemo(() => (snap ? getRuleset(snap.rulesetId as 'karachi' | 'taiwanese') : null), [snap]);
  const view = snap && isPrivate(snap.view) ? snap.view : null;
  const names = useMemo(() => {
    const out: Record<Seat, string> = { 0: 'East', 1: 'South', 2: 'West', 3: 'North' };
    snap?.seats.forEach((s, i) => {
      if (s) out[i as Seat] = i === snap.me ? 'You' : s.name;
    });
    return out;
  }, [snap]);
  const analysis = useMemo(() => (view && ruleset ? analyseFor(view, ruleset) : null), [view, ruleset]);
  const stage = stageFor(progress);
  const coach: CoachState | null = useMemo(
    () => (view && ruleset && analysis ? coachFor({ view, ruleset, analysis, stage, names }) : null),
    [view, ruleset, analysis, stage, names],
  );

  // A 409 means the table changed under us. If nothing has actually happened
  // at the table since (same event sequence: a timer sweep, say, that found
  // nothing to do), the action is as good as it was and goes again against
  // the new version. If the table has moved on, the tap is void and the
  // player is told so, because a tap that silently does nothing is worse
  // than one that fails.
  const send = async (action: ClientAction, retried = false): Promise<void> => {
    if (!snap) return;
    if (action.type === 'discard' && !retried) setProgress((p) => ({ ...p, discardsMade: p.discardsMade + 1 }));
    try {
      take(await api.act(gameId, action, snap.version));
    } catch (err) {
      if (err instanceof ApiError && err.snapshot) {
        const moved = err.snapshot.view.seq !== snap.view.seq;
        take(err.snapshot);
        if (!moved && !retried) return send(action, true);
        setNotice(moved ? explain(err, action) : err.message);
      } else if (err instanceof ApiError && (err.status === 400 || err.status === 403)) {
        void refetch();
        setNotice(explain(err, action));
      } else {
        setNotice(err instanceof ApiError ? err.message : 'That did not reach the table. Check the connection and try again.');
      }
    }
  };

  if (!name) {
    return (
      <NameGate
        title="Take your seat"
        initialName={storedName() ?? ''}
        onDone={(n, token) => {
          rememberName(n);
          setCaptcha(token);
          setName(n);
        }}
      />
    );
  }

  if (!snap || !view || !ruleset || !coach) {
    if (error && !snap) {
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
    return <Waiting>{snap && !view ? 'You are watching this table, not seated at it.' : 'Setting the table…'}</Waiting>;
  }

  if (snap.status === 'abandoned') {
    return <Trouble title="The table has closed." message="Everyone has left this game. Host a new one whenever you like." />;
  }

  const leave = async () => {
    setLeaving('going');
    try {
      await api.leave(gameId);
      router.replace('/');
    } catch (err) {
      setLeaving(null);
      setNotice(err instanceof ApiError ? `Could not leave: ${err.message}.` : 'Could not leave. Check the connection and try again.');
    }
  };

  const deadline = snap.deadlines.turn ?? snap.deadlines.claim;
  const clock =
    deadline !== null && sync && now !== null
      ? { kind: snap.deadlines.turn !== null ? ('turn' as const) : ('claim' as const), ms: Math.max(0, deadline - sync.serverNow - (now - sync.at)) }
      : null;

  const gameOver = snap.status === 'finished';
  // The server settles the room's ledger in the request that finishes the hand,
  // so a snapshot of a finished hand already carries the settled totals.
  const scores = scoresFrom(snap.scores);

  return (
    <>
      <Notice text={notice} onDone={clearNotice} />
      {leaving && (
        <ConfirmSheet
          title="Leave the table?"
          body="A bot plays your seat from here, so the others can carry on. If you are the last one here, the game closes."
          confirmLabel="Leave"
          busy={leaving === 'going'}
          onConfirm={leave}
          onCancel={() => setLeaving(null)}
        />
      )}
      <Table
        view={view}
        label={ruleset.handSpec(view.progress).label}
        subtitle={`Room ${snap.roomCode}`}
        onLeave={() => setLeaving('asking')}
        clock={clock}
        names={names}
        coach={coach}
        tutorOn={tutorOn}
        onToggleTutor={() => setTutorOn((v) => !v)}
        onAct={(a) => void send(a)}
        onNextHand={() => {
          if (gameOver) {
            router.push(`/r/${snap.roomCode}`);
            return;
          }
          setProgress((p) => ({ ...p, handsFinished: p.handsFinished + 1, wins: p.wins + (view.result?.type === 'win' && view.result.winner === view.me ? 1 : 0) }));
          void send({ type: 'nextHand' });
        }}
        claimMs={claimMs}
        gameOver={gameOver}
        scores={scores}
        handsPerRound={ruleset.handsPerRound}
      />
    </>
  );
}

/** What a stand-in did while the player was away, in the player's words. */
function standInText(a: Action): string {
  switch (a.type) {
    case 'discard':
      return `You ran out of time, so a stand-in discarded ${tileName(a.tile)} for you.`;
    case 'pass':
      return 'You ran out of time, so a stand-in passed on that discard for you.';
    case 'claim':
      return a.claim.type === 'win' ? 'You ran out of time, so a stand-in took your Mahjong for you.' : `You ran out of time, so a stand-in took a ${a.claim.type} for you.`;
    case 'exchange':
      return 'You ran out of time, so a stand-in made the exchange for you.';
    case 'declareWin':
      return 'You ran out of time, so a stand-in declared your Mahjong.';
    case 'declareKong':
      return 'You ran out of time, so a stand-in declared a kong for you.';
    default:
      return 'You ran out of time, so a stand-in moved for you.';
  }
}

/** The engine's reasons, in the player's words. */
const TOO_LATE = new Set(['already responded', 'no discard to claim', 'no claims pending', 'not your turn', 'stale version']);
function explain(err: ApiError, action: ClientAction): string {
  if (TOO_LATE.has(err.message)) {
    if (action.type === 'claim')
      return action.claim.type === 'win' ? 'Too late: the window closed before your Mahjong reached the table.' : 'Too late: the window closed before that reached the table.';
    return 'Too late: the table had moved on before that reached it.';
  }
  return `The table did not take that: ${err.message}.`;
}
