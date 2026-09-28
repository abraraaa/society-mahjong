'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRuleset, type Seat } from '@society/engine';
import { Table } from '@/components/table';
import { NameGate } from '@/components/name-gate';
import { AwayNote } from '@/components/away-note';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { Notice } from '@/components/notice';
import { Trouble, Waiting } from '@/components/trouble';
import { analyseFor, coachFor, type CoachState } from '@/lib/coach';
import { retryCanHelp } from '@/lib/front-door';
import { ApiError, api, listen } from '@/lib/live/client';
import { finalStandings } from '@/lib/live/final';
import { handsPlayed } from '@/lib/live/lifecycle';
import { HOST_LEAVE, endLine, endSheet, waitCopy } from '@/lib/live/lifecycle-copy';
import { plainError } from '@/lib/live/plain';
import { IM_BACK, awaySummary, awayTitle, canLetBotPlay, letBotPlayLabel, letBotPlaySheet, seatMarks, tableNews } from '@/lib/live/presence';
import { isPrivate, type GameSnapshot } from '@/lib/live/snapshot';
import type { ClientAction } from '@/lib/live/types';
import { NeedsCaptcha, ensureSession } from '@/lib/supabase/session';
import { useGuestName } from '@/lib/supabase/use-guest-name';
import { liveStage } from '@/lib/live/level';
import { claimMsLeft } from '@/lib/live/timing';
import { useTutorOn } from '@/lib/live/tutor-toggle';
import { scoresFrom } from '@/lib/ledger';
import { canDiscard, discardRefusal } from '@/lib/table-flow';
import { POLL_MS, afterFailedLook, sendMove, shouldPoll, singleFlight, type LookQueue } from '@/lib/table-sync';

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
  // One sheet over the table at a time: Leave, the host's End, or the host handing a seat to a bot (with the server's clock on
  // the table they were looking at when they tapped the name).
  const [sheet, setSheet] = useState<{ readonly kind: 'leave' | 'end' } | { readonly kind: 'bot'; readonly seat: Seat; readonly sawAt: number } | null>(null);
  // A sheet's answer is on its way: its buttons wait for it.
  const [sheetBusy, setSheetBusy] = useState(false);
  // "I'm back" is on its way.
  const [backing, setBacking] = useState(false);
  // Remembered on this phone, so turning the tutor off survives a refresh.
  const [tutorOn, toggleTutor] = useTutorOn();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  // The newest snapshot taken, ahead of the render that shows it.
  const latestRef = useRef<GameSnapshot | null>(null);
  // A move on its way to the table. The ref turns a second tap away at once; the state disables the buttons.
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  // How long the claim sheet waits before passing for the player: the window
  // left when this snapshot was made, on the server's clock so the phone's
  // clock never enters into it, less a margin so the pass lands in time.
  const [claimMs, setClaimMs] = useState<number | null>(null);
  // The server's clock at the moment the snapshot arrived, against the phone's,
  // so the countdown is drawn in server time and a wrong phone clock cannot
  // show a deadline that the table does not have.
  const [sync, setSync] = useState<{ serverNow: number; at: number } | null>(null);
  const [now, setNow] = useState<number | null>(null);

  // Takes a snapshot, and says what changed at the table since the one before (someone left or stepped away, a clock ran out
  // on the reader, whichever phone found it) in the line at the top. A tap's own failure, told after this, has the last word.
  const take = useCallback((s: GameSnapshot): void => {
    const prev = latestRef.current;
    if (prev && s.version < prev.version) return; // an older reply arriving late
    const news = prev ? tableNews(prev, s) : null;
    if (news) setNotice(news);
    latestRef.current = s;
    // A table in hand answers whatever went wrong before it.
    setError(null);
    setDeadEnd(false);
    setClaimMs(claimMsLeft(s));
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
    // What a clock did for the reader comes back in their own absence (tableNews), on this tick or whichever look sees it first.
    const t = setTimeout(
      () =>
        api
          .tick(gameId)
          .then(take)
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
  // The host can tap the name of anyone at the table who's still here, to let a bot play for them. The sheet keeps the server's
  // clock on the table the host was looking at when they tapped (sawAt), so a tap of that person's since then turns it down (R8).
  // Worked out once per table, not per render: it's that table's clock the handlers must carry, so seats alone won't do.
  const seatActions = useMemo(() => {
    const out: Partial<Record<Seat, { label: string; onTap: () => void }>> = {};
    if (!snap) return out;
    for (const seat of [0, 1, 2, 3] as const) {
      const s = snap.seats[seat];
      if (s && canLetBotPlay(snap, seat)) out[seat] = { label: letBotPlayLabel(s.name), onTap: () => setSheet({ kind: 'bot', seat, sawAt: snap.now }) };
    }
    return out;
  }, [snap]);
  const analysis = useMemo(() => (view && ruleset ? analyseFor(view, ruleset) : null), [view, ruleset]);
  // The level the server has tallied for this player, so a refresh or a second phone never starts the tutor from scratch.
  const stage = view ? liveStage(snap?.stage, view) : 'new';
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
    setSheetBusy(true);
    try {
      await api.leave(gameId);
      router.replace('/');
    } catch (err) {
      setSheetBusy(false);
      setSheet(null);
      setNotice(plainError(err));
    }
  };

  // The host ends the game for everyone: the final table comes back, for them and, by the poke, for the rest.
  const endForEveryone = async () => {
    setSheetBusy(true);
    try {
      take(await api.end(gameId));
      setSheet(null);
    } catch (err) {
      if (err instanceof ApiError && err.snapshot) take(err.snapshot);
      else void refetch(true);
      setNotice(plainError(err));
      // Nothing left to end, or not theirs to end: the sheet goes. A slow answer, or the table moving on under them, leaves it
      // up for another tap (the server has already tried again on a fresh table).
      if (err instanceof ApiError && (err.status === 403 || err.message === 'game is over')) setSheet(null);
    } finally {
      setSheetBusy(false);
    }
  };

  // The host hands someone's seat to a bot. Whatever comes back, the sheet goes: the table (or the refusal's copy of it) shows
  // how things stand, and why, if it didn't happen.
  const letBotPlay = async (seat: Seat, sawAt: number) => {
    setSheetBusy(true);
    try {
      take(await api.letBotPlay(gameId, seat, sawAt));
    } catch (err) {
      if (err instanceof ApiError && err.snapshot) take(err.snapshot);
      setNotice(plainError(err));
    } finally {
      setSheetBusy(false);
      setSheet(null);
    }
  };

  // "I'm back": the bot hands the reader's seat back; "Welcome back." comes with the table (tableNews).
  const comeBack = () => {
    setBacking(true);
    api
      .back(gameId)
      .then(take)
      .catch((err: unknown) => {
        // Turned down with the table attached (the game ended, say): show it as it stands.
        if (err instanceof ApiError && err.snapshot) take(err.snapshot);
        setNotice(plainError(err));
      })
      .finally(() => setBacking(false));
  };

  const deadline = snap.deadlines.turn ?? snap.deadlines.claim;
  const clock =
    deadline !== null && sync && now !== null
      ? { kind: snap.deadlines.turn !== null ? ('turn' as const) : ('claim' as const), ms: Math.max(0, deadline - sync.serverNow - (now - sync.at)) }
      : null;

  // The wait for the next hand: who the reader's waiting for once they've tapped, or who's ready and when it starts regardless,
  // counted down on the server's clock, as the table's clocks are.
  const startsAt = snap.nextHand?.startsAt ?? null;
  const msLeft = startsAt !== null && sync && now !== null ? Math.max(0, startsAt - sync.serverNow - (now - sync.at)) : null;
  const wait = snap.status === 'active' && snap.nextHand && snap.me !== null ? waitCopy(snap.nextHand, snap.me, names, msLeft) : null;

  const gameOver = snap.status === 'finished';
  // The running totals are saved with the move that finishes a hand, so a
  // snapshot of a finished hand already carries them, and a finished game's
  // are its final scores.
  const scores = scoresFrom(snap.scores);
  // How the game ended, and who finished top, by their own names: the reader is "You" by seat.
  const ending = gameOver
    ? endLine(
        snap.ended ?? null,
        finalStandings(
          snap.seats.map((s) => s && { name: s.name, bot: s.kind === 'bot' }),
          snap.scores,
        ),
        snap.me,
      )
    : undefined;

  // The sheets are for a game in play: one that ends while a sheet is open (the last hand scored, or ended by the host) closes it.
  const open = snap.status === 'active' ? sheet : null;
  const closeSheet = () => setSheet(null);
  // While a bot plays the reader's tiles, the note says so, over the hand, until they're back: only while a hand is being
  // played (a finished one has its result sheet), and never under another sheet.
  const away = snap.status === 'active' && view.phase !== 'finished' && !open ? snap.mine?.away : null;
  const awayNote = away ? <AwayNote title={awayTitle(away)} detail={awaySummary(snap.mine!.played)} actionLabel={IM_BACK} busy={backing} onAction={comeBack} /> : undefined;
  const botSheet = open?.kind === 'bot' ? open : null;
  const botName = botSheet ? (snap.seats[botSheet.seat]?.name ?? '') : '';

  return (
    <>
      <Notice text={notice} onDone={clearNotice} />
      <Table
        // Each game starts the table afresh, so nothing picked in one game can carry into the next.
        key={gameId}
        view={view}
        label={ruleset.handSpec(view.progress).label}
        subtitle={`Table ${snap.roomCode}`}
        // Leaving is for a game in play: once it's over, the final table's button goes back to the room.
        {...(snap.status === 'active' ? { onLeave: () => setSheet({ kind: 'leave' }) } : {})}
        // The host can end the game between hands; mid-hand, that's in their Leave sheet.
        {...(snap.isHost && snap.status === 'active' && view.phase === 'finished' ? { onEndGame: () => setSheet({ kind: 'end' }) } : {})}
        clock={clock}
        nextLabel={snap.isHost ? 'Play again' : 'Back to the room'}
        names={names}
        coach={coach}
        tutorOn={tutorOn}
        onToggleTutor={toggleTutor}
        onAct={(a) => void send(a)}
        busy={sending}
        onNextHand={() => {
          if (gameOver) {
            router.replace(`/r/${snap.roomCode}`);
            return;
          }
          if (sendingRef.current) return;
          // Named by its hand, so the tap counts as a vote whatever else lands first, and one that arrives after the next hand has
          // started is let go.
          void send({ type: 'nextHand', hand: view.progress.handIndex });
        }}
        claimMs={claimMs}
        gameOver={gameOver}
        scores={scores}
        handsPerRound={ruleset.handsPerRound}
        marks={seatMarks(snap)}
        seatActions={seatActions}
        awayNote={awayNote}
        wait={wait}
        {...(ending !== undefined ? { endLine: ending } : {})}
      />
      {/* Each question opens on the top layer (ConfirmSheet), over the result sheet or whatever other sheet the table has up. */}
      {open?.kind === 'leave' &&
        (snap.isHost ? (
          <ConfirmSheet
            title={HOST_LEAVE.title}
            body={HOST_LEAVE.body}
            confirmLabel={HOST_LEAVE.leave}
            cancelLabel={HOST_LEAVE.stay}
            busy={sheetBusy}
            extras={[{ label: HOST_LEAVE.end, onClick: () => setSheet({ kind: 'end' }) }]}
            onConfirm={leave}
            onCancel={closeSheet}
          />
        ) : (
          <ConfirmSheet
            title="Leave the table?"
            body="A bot plays your seat from here, so the others can carry on. If you are the last one here, the game closes."
            confirmLabel="Leave"
            busy={sheetBusy}
            onConfirm={leave}
            onCancel={closeSheet}
          />
        ))}
      {open?.kind === 'end' && <ConfirmSheet {...endSheet(view.phase !== 'finished', handsPlayed(view))} busy={sheetBusy} onConfirm={endForEveryone} onCancel={closeSheet} />}
      {botSheet && <ConfirmSheet {...letBotPlaySheet(botName)} busy={sheetBusy} onConfirm={() => void letBotPlay(botSheet.seat, botSheet.sawAt)} onCancel={closeSheet} />}
    </>
  );
}
