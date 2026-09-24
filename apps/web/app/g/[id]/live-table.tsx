'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRuleset, tileName, type Action, type PrivatePlayerView, type Seat, type TileKind } from '@society/engine';
import { Table } from '@/components/table';
import { NameGate } from '@/components/name-gate';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { Notice } from '@/components/notice';
import { Trouble, Waiting } from '@/components/trouble';
import { analyseFor, coachFor, stageFor, type CoachState } from '@/lib/coach';
import { retryCanHelp } from '@/lib/front-door';
import { ApiError, api, listen } from '@/lib/live/client';
import { plainError } from '@/lib/live/plain';
import { isPrivate, type GameSnapshot } from '@/lib/live/snapshot';
import type { ClientAction } from '@/lib/live/types';
import { NeedsCaptcha, ensureSession } from '@/lib/supabase/session';
import { useGuestName } from '@/lib/supabase/use-guest-name';
import { scoresFrom } from '@/lib/ledger';
import { canDiscard } from '@/lib/table-flow';
import { POLL_MS, afterFailedLook, sendMove, shouldPoll, singleFlight, type LookQueue } from '@/lib/table-sync';

interface Progress {
  readonly handsFinished: number;
  readonly wins: number;
  readonly discardsMade: number;
}

/**
 * A seat at a live table. The server is the table; this component holds the
 * latest snapshot it was given, sends actions with the version it saw, and
 * refetches whenever the game channel says the version moved, whenever the
 * channel (re)joins, when the phone comes back to the page, and on a slow poll
 * in case Realtime has gone quiet without saying so.
 */
export function LiveTable({ gameId }: { gameId: string }) {
  const router = useRouter();
  const { name, initialName, choose, askAgain } = useGuestName();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A game that isn't there: Try again can't change that.
  const [deadEnd, setDeadEnd] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Why the last tap did nothing, shown over the table for a moment.
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [leaving, setLeaving] = useState<'asking' | 'going' | null>(null);
  const [tutorOn, setTutorOn] = useState(true);
  const [progress, setProgress] = useState<Progress>({ handsFinished: 0, wins: 0, discardsMade: 0 });
  const supabaseRef = useRef<SupabaseClient | null>(null);
  // The newest snapshot taken, ahead of the render that shows it.
  const latestRef = useRef<GameSnapshot | null>(null);
  // A move on its way to the table. The ref turns a second tap away at once; the state disables the buttons.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  // How long the claim window had left when this snapshot was made, measured on
  // the server's clock so the phone's clock never enters into it.
  const [claimMs, setClaimMs] = useState<number | null>(null);
  // The server's clock at the moment the snapshot arrived, against the phone's,
  // so the countdown is drawn in server time and a wrong phone clock cannot
  // show a deadline that the table does not have.
  const [sync, setSync] = useState<{ serverNow: number; at: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const take = useCallback((s: GameSnapshot) => {
    if (latestRef.current && s.version < latestRef.current.version) return; // an older reply arriving late
    latestRef.current = s;
    // A table in hand answers whatever went wrong before it.
    setError(null);
    setDeadEnd(false);
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

  // One look at a time: pokes, rejoins and wake-ups that come in while a look
  // is on its way share one more look after it (singleFlight). A look that
  // fails says nothing if a newer table has come in since it set out or
  // another look is about to go, and speaks up over the table only once there
  // is one (afterFailedLook). `quiet` is for the poll: a look that fails every
  // twelve seconds while the phone is offline would otherwise say so every twelve seconds.
  const looksRef = useRef<{ gameId: string; queue: LookQueue } | null>(null);
  const refetch = useCallback(
    (quiet = false) => {
      if (looksRef.current?.gameId !== gameId) {
        const queue = singleFlight(async (quietly, another) => {
          const before = latestRef.current;
          try {
            take(await api.view(gameId));
          } catch (err) {
            const next = afterFailedLook({ before, latest: latestRef.current, another: another(), quiet: quietly });
            if (next === 'ignore') return;
            const msg = plainError(err);
            setError(msg);
            setDeadEnd(!retryCanHelp(err));
            if (next === 'tell') setNotice(msg);
          }
        });
        looksRef.current = { gameId, queue };
      }
      return looksRef.current.queue.ask(quiet);
    },
    [gameId, take],
  );

  // Session, subscription, first view.
  useEffect(() => {
    if (!name) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    // Looking again before there is a session would only be turned away.
    let ready = false;
    const lookAgain = () => {
      if (ready && !cancelled) void refetch();
    };
    (async () => {
      try {
        const { supabase } = await ensureSession(name, captcha);
        if (cancelled) return;
        supabaseRef.current = supabase;
        // Subscribe first, then fetch, so no poke can fall in between. A poke
        // sent while the channel was down is gone for good, so every SUBSCRIBED
        // (the first join, and each rejoin after a dropped connection) looks again.
        stop = listen(
          supabase,
          `game:${gameId}`,
          {
            state: (p) => {
              if (typeof p['version'] !== 'number' || p['version'] > (latestRef.current?.version ?? 0)) void refetch();
            },
          },
          (status) => status === 'SUBSCRIBED' && lookAgain(),
        );
        ready = true;
        await refetch();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof NeedsCaptcha) askAgain();
        else setError(plainError(err));
      }
    })();
    // Back on the page: a phone that slept, switched apps or changed networks may have missed pokes.
    const onVisible = () => document.visibilityState === 'visible' && lookAgain();
    const onShow = (e: PageTransitionEvent) => e.persisted && lookAgain();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', lookAgain);
    window.addEventListener('pageshow', onShow);
    return () => {
      cancelled = true;
      stop?.();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', lookAgain);
      window.removeEventListener('pageshow', onShow);
    };
  }, [name, captcha, gameId, refetch, attempt, askAgain]);

  // The slow poll: every twelve seconds while the game is in play and on
  // screen, and never over the top of a move of ours or a look already on its way.
  const inPlay = snap?.status === 'active';
  useEffect(() => {
    if (!inPlay) return;
    const id = setInterval(() => {
      const visible = document.visibilityState === 'visible';
      const looking = looksRef.current?.queue.looking() ?? false;
      if (shouldPoll({ status: latestRef.current?.status ?? null, visible, sending: sendingRef.current, looking })) void refetch(true);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [inPlay, refetch]);

  // The room's own channel: when the host deals again after this game, everyone
  // still on the old table follows to the new one.
  const roomId = snap?.roomId ?? null;
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!roomId || !supabase) return;
    return listen(supabase, `room:${roomId}`, {
      started: (p) => {
        if (typeof p['gameId'] === 'string' && p['gameId'] !== gameId) router.replace(`/g/${p['gameId']}`);
      },
    });
  }, [roomId, gameId, router]);

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

  // One move at a time: a second tap while one is on its way is ignored.
  // A 409 means the table changed under us. The newer table it carries is
  // taken at once, and if nothing has actually happened at the table since
  // (another player's exchange or pass, say) and the move is still open, it
  // goes once more against that table (sendMove and afterConflict). Otherwise
  // the tap is void and the player is told so, because a tap that silently
  // does nothing is worse than one that fails. A request that gets no answer
  // in time is given up on, and the table looked at again.
  const send = async (action: ClientAction): Promise<void> => {
    if (!snap || sendingRef.current) return;
    // Never send a discard of a tile this seat doesn't hold, or out of turn:
    // the server would only refuse it, in its own words.
    if (action.type === 'discard' && (!view || !canDiscard(view, action.tile))) {
      setNotice(discardRefusal(view, action.tile));
      return;
    }
    sendingRef.current = true;
    setSending(true);
    if (action.type === 'discard') setProgress((p) => ({ ...p, discardsMade: p.discardsMade + 1 }));
    try {
      const out = await sendMove(
        action,
        snap,
        (version) => api.act(gameId, action, version),
        take,
        () => latestRef.current,
      );
      // Let go without the table attached: look, so the player sees where things now stand.
      if (out.kind === 'quiet' && out.look) void refetch();
      if (out.kind !== 'failed') return;
      const err = out.err;
      setNotice(plainError(err));
      // No answer at all: the move may or may not have landed, so look (quietly: the notice has said enough).
      if (!(err instanceof ApiError) || err.status === 0) void refetch(true);
      // Refused without the table attached: look, so the next tap is made on the table as it is.
      else if (!err.snapshot && (err.status === 400 || err.status === 403 || err.status === 409)) void refetch();
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!name) {
    return (
      <NameGate
        title="Take your seat"
        initialName={initialName}
        onDone={(n, token) => {
          setCaptcha(token);
          choose(n);
        }}
      />
    );
  }

  if (!snap || !view || !ruleset || !coach) {
    if (error && !snap) {
      return (
        <Trouble
          message={error}
          onRetry={
            deadEnd
              ? undefined
              : () => {
                  setError(null);
                  // What went wrong is on screen already; it mustn't pop up again over the table that loads.
                  setNotice(null);
                  // A captcha token is spent once it's been tried; with no session yet, a retry goes back to the gate for a fresh one.
                  setCaptcha(null);
                  setAttempt((n) => n + 1);
                }
          }
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
      setNotice(plainError(err));
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
        // Each game starts the table afresh, so nothing picked in one game can carry into the next.
        key={gameId}
        view={view}
        label={ruleset.handSpec(view.progress).label}
        subtitle={`Room ${snap.roomCode}`}
        onLeave={() => setLeaving('asking')}
        clock={clock}
        nextLabel={snap.isHost ? 'Play again' : 'Back to the room'}
        names={names}
        coach={coach}
        tutorOn={tutorOn}
        onToggleTutor={() => setTutorOn((v) => !v)}
        onAct={(a) => void send(a)}
        busy={sending}
        onNextHand={() => {
          if (gameOver) {
            router.replace(`/r/${snap.roomCode}`);
            return;
          }
          if (sendingRef.current) return;
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

/** Why a discard wasn't sent, in the player's words, with what to do instead. */
function discardRefusal(view: PrivatePlayerView | null, tile: TileKind): string {
  if (view && view.phase === 'turn' && view.turn === view.me) return `You're not holding ${tileName(tile)} any more. Pick another tile to discard.`;
  return "It's not your turn to discard yet. Hang on until it comes round to you.";
}
