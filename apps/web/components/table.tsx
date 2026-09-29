'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SEATS, acrossFrom, leftOf, rightOf, tileName, type Action, type PrivatePlayerView, type Seat, type TileKind } from '@society/engine';
import { Tile } from '@/components/tile';
import { SeatPill } from '@/components/seat-pill';
import { ClaimSheet } from '@/components/claim-sheet';
import { Coach, CoachLine, CoachNotes, TermProvider, TutorSheet, useLesson, useOpenTerm, useSheetActions } from '@/components/coach';
import { PlanStrip } from '@/components/plan-strip';
import { River } from '@/components/river';
import { useHeldHeight } from '@/components/use-held-height';
import { riverOrder } from '@/lib/river';
import { NO_SCORES, handDeltas, signed, standings, type Scores } from '@/lib/ledger';
import { LIFT_SETTLE_MS, discardOffer, handBoundary, heldSelection, selectTile, settling, type Selection } from '@/lib/table-flow';
import { suggestedDiscard, type CoachState } from '@/lib/coach';
import { finalStandings } from '@/lib/live/final';
import { endLine as endLineFor } from '@/lib/live/lifecycle-copy';
import { cardClockFor, claimSheetClock } from '@/lib/coach/clock';
import {
  WAIT_SHOW_MS,
  exchangeGlow,
  exchangeHeading,
  exchangeProgress,
  goesToLine,
  passedKeys,
  passedLine,
  receiverOf,
  tileKeys,
  viewExchangeStep,
  waitingFor,
  type ExchangeStep,
} from '@/lib/coach/exchange';
import { CLAIM_PASS_MARGIN_MS } from '@/lib/live/timing';
import type { Lesson } from '@/lib/coach/teach';

/** A player's name inside a sentence, isolated so a right-to-left name can't reorder the words and clock around it. */
const isolate = (name: string | undefined): string => `\u2068${name ?? ''}\u2069`;

/** What a seat can send: every engine action except the server's own `resolveClaims`. */
export type SeatAction = Exclude<Action, { type: 'resolveClaims' }>;

/** Custom properties are not part of React's CSSProperties, so name the one we set. */
type HandStyle = React.CSSProperties & { '--hand-n'?: number };

/** Every kind is in the wall four times, which is what makes "already dead" answerable. */
const COPIES = 4;

/** A tile picked up from the hand: its kind, and which copy of it was tapped, so a pair or a pung lifts one tile, not all of them. */
type HandPick = Selection & { readonly copy: number };

/** The tile a pick lifts in this view, or null once the pick has gone stale. A claim can take copies away; the pick then stays with the last one left. */
function liftOf(pick: HandPick | null, view: PrivatePlayerView): { readonly kind: TileKind; readonly copy: number } | null {
  const kind = heldSelection(pick, view);
  if (!pick || kind === null) return null;
  return { kind, copy: Math.min(pick.copy, view.concealed.filter((k) => k === kind).length - 1) };
}

export interface TableProps {
  /** this seat's view of the table, from the engine directly (solo) or the server (live) */
  readonly view: PrivatePlayerView;
  readonly label: string;
  readonly names: Readonly<Record<Seat, string>>;
  readonly coach: CoachState;
  readonly tutorOn: boolean;
  readonly onToggleTutor: () => void;
  readonly onAct: (action: SeatAction) => void;
  readonly onNextHand: () => void;
  /** how long the current claim window has left, for the sheet's countdown; the solo default otherwise */
  readonly claimMs?: number | null;
  /** the game has no next hand; the result sheet says so instead of offering one */
  readonly gameOver?: boolean;
  /** shown under the title, e.g. the room code */
  readonly subtitle?: string;
  /** running totals; the seat pills and the result sheet show them */
  readonly scores?: Scores;
  /** how many hands a round has, for the "hand 2 of 4" counter */
  readonly handsPerRound?: number;
  /** stand up from the table; the page decides what that means and asks first */
  readonly onLeave?: () => void;
  /** what the result sheet's button says when the game is over; "Play again" by default */
  readonly nextLabel?: string;
  /** the live table's ticking clock: whose deadline is running and how long is left */
  readonly clock?: { readonly kind: 'turn' | 'claim'; readonly ms: number } | null;
  /** a move is on its way to the table: the action buttons are disabled, and a second tap does nothing until it lands */
  readonly busy?: boolean;
  /** what plays each seat that a person doesn't: a bot's seat is marked on its pill, in the result sheet's rows and on the final table; an away person's on its pill */
  readonly marks?: Readonly<Partial<Record<Seat, 'bot' | 'away'>>>;
  /** seats whose name is a button (the host handing a seat to a bot): what a screen reader hears, and what a tap does */
  readonly seatActions?: Readonly<Partial<Record<Seat, { readonly label: string; readonly onTap: () => void }>>>;
  /** the note a player comes back to while a bot plays their tiles: drawn in place of the claim and pass sheets, and the result sheet, while it's set */
  readonly awayNote?: React.ReactNode;
  /** the line under the final scores, when the page knows how the game ended; "That's the game." and who finished top otherwise */
  readonly endLine?: string;
  /** the host ends the game here, from the result sheet: shown only between hands of a game still in play; the page asks first */
  readonly onEndGame?: () => void;
  /** the wait for the next hand at a live table: what Next hand says, the line under it, and whether the reader has tapped it already (then it can't be again) */
  readonly wait?: { readonly button: string; readonly line: string | null; readonly ready: boolean } | null;
}

/** Under this much time left, the clock turns brass and pulses. */
const URGENT_MS = 20_000;

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The table as a pure function of one seat's view. It owns nothing but the
 * selection and renders the same way whether the view came from a local
 * reducer (the solo table) or a route handler (a live table).
 */
export function Table(props: TableProps) {
  return (
    <TermProvider>
      <TableInner {...props} />
    </TermProvider>
  );
}
const ROUND_NAME: Record<string, string> = { E: 'East', S: 'South', W: 'West', N: 'North' };

function TableInner({
  view,
  label,
  names,
  coach,
  tutorOn,
  onToggleTutor,
  onAct,
  onNextHand,
  claimMs,
  gameOver,
  subtitle,
  scores = NO_SCORES,
  handsPerRound = 4,
  onLeave,
  clock,
  nextLabel,
  busy = false,
  marks,
  seatActions,
  awayNote,
  endLine,
  onEndGame,
  wait,
}: TableProps) {
  const ME = view.me;
  const openTerm = useOpenTerm();
  const counter = `${ROUND_NAME[view.progress.roundWind] ?? view.progress.roundWind} round · hand ${view.progress.handInRound + 1} of ${handsPerRound} · wall ${view.wallRemaining}`;
  const sub = subtitle ? `${subtitle} · ${counter}` : counter;
  const me = view.players[ME];
  const legal = view.legal;
  const [pick, setPick] = useState<HandPick | null>(null);
  // The pick is only ever read through heldSelection, which drops it once the
  // hand changes, the player's discard turn has come and gone, or the tile has
  // left the hand. A tile lifted during the bots' moves can't linger into the
  // next hand and put a tile the player doesn't hold on the Discard button.
  const lift = liftOf(pick, view);
  const selected = lift?.kind ?? null;

  // When the hand last started or finished. A tap that comes hard on its heels
  // (the second tap of a double tap on Next hand, landing on the new hand's
  // tiles or its Discard button) was meant for the table before, so it's let go.
  const boundary = handBoundary(view);
  const boundaryAt = useRef(0);
  // Before paint, so the new hand is never on screen without its grace period.
  useLayoutEffect(() => {
    boundaryAt.current = performance.now();
  }, [boundary]);
  const tooSoon = useCallback(() => settling(boundaryAt.current, performance.now()), []);
  // A card or a word left open doesn't outlive the hand it was about.
  const { close: closeSheet } = useSheetActions();
  useEffect(() => closeSheet(), [boundary, closeSheet]);
  // A tap that only lifts a tile is let go sooner: it can be put straight back.
  const tooSoonToLift = useCallback(() => settling(boundaryAt.current, performance.now(), LIFT_SETTLE_MS), []);

  const act = (a: SeatAction) => {
    if (busy || tooSoon()) return;
    setPick(null);
    onAct(a);
  };

  const myTurn = view.phase === 'turn' && view.turn === ME && !!legal.discard;
  const advice = tutorOn ? coach : null;
  // This view's first-sight footnotes, for the bubble and the sheets alike.
  const lesson = useLesson(coach, tutorOn);
  const suggested = advice ? suggestedDiscard(advice.action) : null;
  // The kong the tutor advises, when it costs the hand nothing: its button is the lit one.
  const kongTip = advice?.action.kind === 'kong' ? advice.action.tile : null;
  // The player's own pick wins over the tutor's, but only a tile they hold is ever offered.
  const offer = discardOffer(view, selected, suggested);
  const hasActions = !!legal.win || !!legal.kong?.length || offer !== null || myTurn;
  // stable sort means duplicates of a newly-drawn kind land last, so this always resolves the tile just drawn
  const drawnIndex = view.drawn ? view.concealed.lastIndexOf(view.drawn) : -1;

  const left = view.players[leftOf(ME)];
  const across = view.players[acrossFrom(ME)];
  const right = view.players[rightOf(ME)];

  const riverTiles = useMemo(() => riverOrder(view), [view]);
  const selectedOut = selected ? riverTiles.filter((t) => t.kind === selected).length : 0;

  const header = (
    <>
      <div className="min-w-0">
        <h1 className="font-display truncate text-xl">{label}</h1>
        <p className="text-ivory-200/50 truncate text-xs">{sub}</p>
      </div>
      <div className="flex flex-none items-center gap-2">
        <span className="text-ivory-200/60 text-sm whitespace-nowrap">{signed(scores[ME])}</span>
        <button type="button" className={`chip${tutorOn ? ' chip-gold' : ''}`} onClick={onToggleTutor}>
          Tutor {tutorOn ? 'on' : 'off'}
        </button>
        <button type="button" className="chip" aria-label="Glossary" onClick={() => openTerm('all')}>
          ?
        </button>
        {onLeave && (
          <button type="button" className="chip" onClick={onLeave}>
            Leave
          </button>
        )}
      </div>
    </>
  );

  const riverHeader = (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <p className="label">River</p>
      {/* One width for both wordings, so a pick changes the words and not the box. */}
      <p className="label min-w-28 text-right whitespace-nowrap tabular-nums">{selected ? `${selectedOut} of ${COPIES} out` : `${riverTiles.length} discarded`}</p>
    </div>
  );
  const river = <River tiles={riverTiles} claimable={view.phase === 'claim'} highlight={selected} />;

  // New and learning players see their plan laid out above their tiles; a regular gets the one line in the bubble.
  const withStrip = !!advice && advice.stage !== 'solid';
  const strip = withStrip ? <PlanStrip target={advice.target} /> : null;
  const bubble = advice ? <Coach plan={advice.plan} target={advice.target} say={advice.say} coach={advice} lesson={lesson} planInStrip={withStrip} /> : null;

  const actions = (
    <>
      {legal.win && (
        <button className="btn btn-gold" disabled={busy} onClick={() => act({ type: 'declareWin', seat: ME })}>
          Mahjong!
        </button>
      )}
      {legal.kong?.map((k) => (
        <button key={k} className={`btn ${kongTip === k ? 'btn-primary' : 'btn-ghost'}`} disabled={busy} onClick={() => act({ type: 'declareKong', seat: ME, tile: k })}>
          Kong {tileName(k)}
        </button>
      ))}
      {offer ? (
        // While a kong is the tip and nothing's picked, Discard steps back and offers the tile to let go instead.
        <button className={`btn ${kongTip && !selected ? 'btn-ghost' : 'btn-primary'} btn-discard`} disabled={busy} onClick={() => act({ type: 'discard', seat: ME, tile: offer })}>
          Discard {tileName(offer)}
        </button>
      ) : (
        // Nothing to offer yet (the tutor is off, or its tip isn't a discard):
        // the button waits, disabled, where it will be, so a pick doesn't
        // squeeze the felt and move the river.
        myTurn && (
          <button className="btn btn-primary btn-discard" disabled>
            Discard
          </button>
        )
      )}
    </>
  );

  // One handler per place in the hand, remade only when the hand changes, so
  // a pick re-renders just the tiles it lifts and drops.
  const liftAt = useCallback(
    (i: number) => {
      const kind = view.concealed[i];
      if (kind === undefined || tooSoonToLift()) return;
      const copy = view.concealed.slice(0, i).filter((k) => k === kind).length;
      setPick((p) => {
        const now = liftOf(p, view);
        return now?.kind === kind && now.copy === copy ? null : { ...selectTile(kind, view), copy };
      });
    },
    [view, tooSoonToLift],
  );
  const tileTaps = useMemo(() => view.concealed.map((_, i) => () => liftAt(i)), [view.concealed, liftAt]);

  const handTiles = (size: 'md' | 'lg') => {
    const copies = new Map<TileKind, number>();
    return view.concealed.map((k, i) => {
      const copy = copies.get(k) ?? 0;
      copies.set(k, copy + 1);
      const isDrawn = i === drawnIndex && myTurn;
      return (
        <Tile
          // By kind and copy, not place: a draw sorted into the middle of the
          // hand mounts one tile instead of replacing every tile after it.
          key={`${k}#${copy}`}
          kind={k}
          size={size}
          // Always selectable: a tap while the bots are still moving lifts the
          // tile and reads the river for it; the discard button waits for the turn.
          selectable
          selected={lift?.kind === k && lift.copy === copy}
          fresh={isDrawn}
          // Kept on while the tile is lifted: the stylesheet fades it under the ring.
          coached={!!advice && advice.highlight.includes(k)}
          className={isDrawn ? 'drawn' : undefined}
          onClick={tileTaps[i]}
        />
      );
    });
  };

  const myMelds = (
    <div className="meld-row">
      {me.melds.map((m, i) => (
        <span key={i} className="meld">
          {m.tiles.map((k, j) => (
            <Tile key={j} kind={k} size="xs" />
          ))}
        </span>
      ))}
    </div>
  );

  const bonus = (
    <div className="meld-row justify-center">
      {me.bonus.map((k, i) => (
        <Tile key={i} kind={k} size="xs" />
      ))}
    </div>
  );

  // The rail and the landscape tray size their tiles from how many there
  // actually are, which CSS can only know if we tell it.
  const handStyle: HandStyle = { '--hand-n': Math.max(view.concealed.length, 1) };

  const urgent = !!clock && clock.ms <= URGENT_MS;
  const seatPill = (p: typeof left, orientation?: 'column') => (
    <SeatPill
      wind={p.seatWind}
      name={names[p.seat]}
      concealedCount={p.concealedCount}
      melds={p.melds}
      isTurn={view.turn === p.seat}
      score={signed(scores[p.seat])}
      clock={clock && clock.kind === 'turn' && view.phase === 'turn' && view.turn === p.seat ? mmss(clock.ms) : undefined}
      urgent={urgent}
      mark={marks?.[p.seat]}
      onTap={seatActions?.[p.seat]?.onTap}
      tapLabel={seatActions?.[p.seat]?.label}
      {...(orientation ? { orientation } : {})}
    />
  );

  const claimOpen = view.phase === 'claim' && !!legal.claims && legal.claims.length > 0 && !!view.lastDiscard;
  // Which pass of the West exchange this is, and which way it goes; null outside the exchange.
  const exchange = viewExchangeStep(view);
  // In a claim window the live table always passes claimMs (0 in the window's
  // last moments, so never test it for truth), and solo never does. What a card
  // or a word opened now says about the clock under it: the bots' claim held,
  // or a live clock still running.
  const live = claimMs != null;
  // A win on offer is never passed for the player: on the bots it isn't timed, and at a live table the table's clock
  // runs out and its stand-in takes it, so the sheet's bar and a card both count to the table's deadline.
  const offersWin = claimOpen && !!legal.claims?.some((c) => c.type === 'win');
  const cardClock = cardClockFor({
    claimOpen,
    soloClaimTimed: claimOpen && !live && !offersWin,
    clock: clock ?? null,
    myTurn,
    exchange: !!legal.exchange,
    winOffered: offersWin,
    passMarginMs: CLAIM_PASS_MARGIN_MS,
  });

  // The line above the hand that says whose clock is running, when it is
  // mine or when I am waiting on someone else's claim. A bot's clock never
  // runs: the server plays it inline.
  let clockLine: string | null = null;
  if (clock) {
    if (clock.kind === 'turn' && view.phase === 'turn' && view.turn === ME) clockLine = `Your turn · ${mmss(clock.ms)}`;
    else if (clock.kind === 'turn' && view.phase === 'preplay' && legal.exchange) clockLine = `Your exchange · ${mmss(clock.ms)}`;
    else if (clock.kind === 'claim' && view.phase === 'claim' && !claimOpen) {
      const waiting = view.players.filter((p) => p.seat !== ME && p.seat !== view.lastDiscard?.from && !p.responded).map((p) => isolate(names[p.seat]));
      if (waiting.length > 0) clockLine = `Waiting for ${waiting.join(' and ')} · ${mmss(clock.ms)}`;
    }
  }
  const clockEl = clockLine && (
    <p className="turn-clock" data-urgent={urgent || undefined}>
      {clockLine}
    </p>
  );

  return (
    <>
      {/* Phone, either way up: hand at the bottom, river taking whatever is left over. */}
      <div className="table-stage">
        <header className="flex flex-none items-baseline justify-between gap-2">{header}</header>

        <div className="seat-strip grid flex-none grid-cols-3 gap-2">
          {[left, across, right].map((p) => (
            <span key={p.seat} className="contents">
              {seatPill(p)}
            </span>
          ))}
        </div>

        <section className="felt flex min-h-0 flex-1 flex-col rounded-2xl p-2">
          {riverHeader}
          {river}
        </section>

        {bubble}

        {hasActions && !gameOver && <div className="action-row flex-none">{actions}</div>}

        <section className="hand-dock flex-none">
          {clockEl}
          {strip}
          {me.melds.length > 0 && myMelds}
          <div className="hand-tray" style={handStyle}>
            {handTiles('md')}
          </div>
          {me.bonus.length > 0 && bonus}
        </section>
      </div>

      {/* Landscape tablet: the full square table. */}
      <div className="table-grid mx-auto h-dvh max-w-5xl grid-cols-[120px_1fr_120px] grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-3 overflow-hidden px-6 pt-[max(1rem,var(--safe-top))] pb-[max(1rem,var(--safe-bottom))]">
        <div className="col-span-3 flex items-center justify-between gap-3">{header}</div>

        {seatPill(left, 'column')}

        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex justify-center">{seatPill(across)}</div>
          <section className="felt flex min-h-0 flex-1 flex-col rounded-2xl p-4">
            {riverHeader}
            {river}
          </section>
        </div>

        {seatPill(right, 'column')}

        <div className="col-span-3">{bubble}</div>

        <div className="hand-dock col-span-3">
          {clockEl}
          {strip}
          {me.melds.length > 0 && myMelds}
          <div className="hand-rail" style={handStyle}>
            {handTiles('lg')}
          </div>
          {me.bonus.length > 0 && bonus}
          {hasActions && !gameOver && <div className="action-row">{actions}</div>}
        </div>
      </div>

      {claimOpen && view.lastDiscard && !gameOver && !awayNote && (
        <ClaimSheet
          discardKind={view.lastDiscard.kind}
          discarderName={names[view.lastDiscard.from]}
          discardCount={view.discardCount}
          coach={coach}
          lesson={lesson}
          options={legal.claims!}
          onClaim={(claim) => act({ type: 'claim', seat: ME, claim })}
          onPass={() => act({ type: 'pass', seat: ME })}
          busy={busy}
          {...claimSheetClock(claimMs, offersWin, CLAIM_PASS_MARGIN_MS)}
        />
      )}

      {view.phase === 'preplay' && !gameOver && !awayNote && (
        // One sheet from the first pass to the last, waits included, so it never slides away and back between passes.
        // The sheet lets go of the last pass's picks itself when the next one starts. Not while a bot plays the seat.
        <ExchangeSheet
          hand={view.concealed}
          count={legal.exchange?.count ?? exchange?.count ?? 3}
          step={exchange}
          to={exchange ? isolate(names[receiverOf(ME, exchange.direction)]) : null}
          waiting={!legal.exchange}
          passed={view.myExchange}
          waitingLine={waitingFor(view, names)}
          coach={coach}
          lesson={lesson}
          busy={busy}
          tooSoon={tooSoonToLift}
          onDone={(tiles) => act({ type: 'exchange', seat: ME, tiles })}
        />
      )}

      {(view.phase === 'finished' || gameOver) && !awayNote && (
        <ResultSheet
          coach={coach}
          lesson={lesson}
          gameOver={!!gameOver}
          // A tap meant for the table just as the hand ended mustn't skip the debrief.
          onNext={() => !tooSoon() && onNextHand()}
          view={view}
          names={names}
          scores={scores}
          nextLabel={nextLabel}
          busy={busy}
          marks={marks}
          endLine={endLine}
          onEndGame={gameOver ? undefined : onEndGame}
          wait={gameOver ? null : wait}
        />
      )}

      {/* In place of the result sheet, never beside it: set on a finished hand only for someone on a break, whose Next hand waits for "I'm back". */}
      {awayNote}

      <TutorSheet coach={coach} clock={cardClock} />
    </>
  );
}

function ExchangeSheet({
  hand,
  count,
  step,
  to,
  waiting,
  passed,
  waitingLine,
  coach,
  lesson,
  busy,
  tooSoon,
  onDone,
}: {
  hand: readonly TileKind[];
  count: number;
  /** which pass this is, and which way it goes */
  step: ExchangeStep | null;
  /** who gets the tiles, isolated */
  to: string | null;
  /** the player has passed and the others haven't */
  waiting: boolean;
  /** what the table recorded as passed for her while she waits (`myExchange`), whoever passed it */
  passed: readonly TileKind[] | undefined;
  /** who hasn't passed yet, or null when nobody's left */
  waitingLine: string | null;
  coach: CoachState;
  lesson: Lesson | null;
  busy: boolean;
  /** true just after the hand was dealt, when a tap is a leftover from the hand before */
  tooSoon: () => boolean;
  onDone: (tiles: TileKind[]) => void;
}) {
  // Picks by kind and copy, not place, so the next pass's hand can't move a pick onto another tile.
  const keys = useMemo(() => tileKeys(hand), [hand]);
  const [picked, setPicked] = useState<string[]>([]);
  // A new pass lets go of the last one's picks. A table that comes back on the same pass (another player's exchange
  // landing first) keeps them.
  const [at, setAt] = useState(step?.step);
  if (at !== step?.step) {
    setAt(step?.step);
    setPicked([]);
  }
  // A short wait looks like no wait: the sheet keeps the line and footnotes of the player's pass until a wait has
  // lasted, and only then says who it's waiting for, clears its tint and lets taps through to the table above it.
  const [line, setLine] = useState({ coach, lesson });
  if (!waiting && (line.coach !== coach || line.lesson !== lesson)) setLine({ coach, lesson });
  const shown = waiting ? line : { coach, lesson };
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setWaited(true), WAIT_SHOW_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  if (!waiting && waited) setWaited(false);
  const waitingShown = waiting && waited;
  // While she waits, the tiles lifted are the ones the table has going, which aren't hers if the clock or her other
  // phone passed first. Her own picks, when they're those, stay as they were.
  const lifted = waiting ? passedKeys(hand, picked, passed) : picked;
  // The line under the heading keeps the height of its longest words, so the sheet's top and heading stay put as its
  // line changes to the wait and on to the next pass.
  const lineBox = useHeldHeight<HTMLDivElement>();

  // The coach has already worked out which tiles no candidate hand is using; the player can overrule it, but the
  // sheet opens on its answer rather than empty. Exactly the copies it suggests are lit: one of two held, if one.
  const suggested = coach.action.kind === 'exchange' ? coach.action.tiles : [];
  const glow = exchangeGlow(hand, suggested);
  const chosen = picked.filter((k) => keys.includes(k));
  // A pick past the count lets go of the oldest rather than doing nothing.
  const taps = useMemo(
    () =>
      keys.map((key) => () => {
        if (tooSoon()) return;
        setPicked((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key].slice(-count)));
      }),
    [keys, count, tooSoon],
  );
  return (
    <>
      <div className="scrim scrim-plain" data-waiting={waitingShown || undefined} />
      <div className="sheet" data-sheet="exchange" data-waiting={waitingShown || undefined}>
        <div className="grabber" />
        <h2 className="font-display mb-1 text-xl">
          {exchangeHeading(step, count)}
          {step && <span className="step"> · {exchangeProgress(step)}</span>}
        </h2>
        <div ref={lineBox} className="mb-3">
          {waitingShown ? (
            <p className="text-ivory-200/70 text-sm">{passedLine(waitingLine)}</p>
          ) : (
            <>
              <p className="text-ivory-200/70 text-sm">
                {to && `${goesToLine(to)} `}
                <CoachLine say={shown.coach.say} origin="exchange" />
              </p>
              <CoachNotes coach={shown.coach} lesson={shown.lesson} where="sheet" />
            </>
          )}
        </div>
        {/* Room above each row for a lifted tile and its ring (10px + 3px): the caption's margin and a pixel, and the row gap. */}
        <div className="flex flex-wrap justify-center gap-x-1 gap-y-[13px] pt-px">
          {hand.map((k, i) => (
            <Tile
              key={keys[i]}
              kind={k}
              size="md"
              selectable={!waiting}
              selected={lifted.includes(keys[i]!)}
              // The tips stay lit after the first pick; a picked tile's fades under its ring.
              coached={!waiting && glow[i]}
              onClick={taps[i]}
            />
          ))}
        </div>
        {/* The same words throughout, so the button never changes width. */}
        <button className="btn btn-primary btn-block mt-3" disabled={busy || waiting || chosen.length !== count} onClick={() => onDone(chosen.map((k) => hand[keys.indexOf(k)]!))}>
          Pass tiles
        </button>
      </div>
    </>
  );
}

/**
 * The debrief. A beginner learns more here than anywhere else in the hand, so it
 * shows the winning tiles laid out, names the hand the way players name it —
 * never the engine's pattern id — and says what it cost or paid. When the game
 * is over it becomes the final table: the scores ranked, and a line saying how
 * the game ended and who finished top.
 */
function ResultSheet({
  coach,
  lesson,
  gameOver,
  onNext,
  view,
  names,
  scores,
  nextLabel,
  busy,
  marks,
  endLine,
  onEndGame,
  wait,
}: {
  coach: CoachState;
  lesson: Lesson | null;
  gameOver: boolean;
  onNext: () => void;
  nextLabel?: string | undefined;
  busy: boolean;
  view: PrivatePlayerView;
  names: Readonly<Record<Seat, string>>;
  scores: Scores;
  marks?: Readonly<Partial<Record<Seat, 'bot' | 'away'>>> | undefined;
  endLine?: string | undefined;
  onEndGame?: (() => void) | undefined;
  wait?: TableProps['wait'];
}) {
  const outcome = coach.outcome;
  const deltas = handDeltas(view.result);
  const order = standings(scores);
  const paid = view.result?.type === 'win';
  const final = gameOver
    ? finalStandings(
        SEATS.map((s) => ({ name: names[s], bot: marks?.[s] === 'bot' })),
        SEATS.map((s) => scores[s]),
      )
    : [];
  return (
    <>
      <div className="scrim" />
      {/* Never taller than the screen: on a phone lying down a won hand's tiles and the scores don't fit, so the sheet scrolls
          from its title, and its buttons stay pinned to its foot (their row carries the sheet's bottom padding). */}
      <div className="sheet max-h-[calc(100dvh_-_var(--safe-top)_-_8px)] overflow-y-auto overscroll-contain pb-0!">
        <div className="grabber" />
        {view.phase === 'finished' && (
          <>
            <h2 className="font-display mb-2 text-xl">{outcome?.type === 'win' ? (outcome.winnerIsMe ? 'Mahjong!' : `${outcome.winnerName} wins`) : 'Washed out'}</h2>
            {outcome?.tiles && outcome.tiles.length > 0 && (
              <div className="mb-3 flex flex-wrap justify-center gap-1">
                {outcome.tiles.map((k, i) => (
                  <Tile key={i} kind={k} size="xs" />
                ))}
              </div>
            )}
            <p className="text-ivory-100/90 text-sm">
              <CoachLine say={coach.say} origin="result" />
            </p>
            <CoachNotes coach={coach} lesson={lesson} where="sheet" />
          </>
        )}
        {gameOver ? (
          // The spacing sits on the wrapper and the rows: the stylesheet's h1-h3 reset outranks a margin utility on the heading.
          <div className="mt-4">
            <h3 className="label">Final scores</h3>
            <div className="standings mt-1">
              {final.map((st) => (
                <div key={st.seat} className={`row${st.seat === view.me ? ' is-me' : ''}`}>
                  <span className="who">
                    <span className="text-ivory-200/55 mr-2">{st.rank}</span>
                    {st.name}
                    {st.bot && ' · bot'}
                  </span>
                  <span className="delta" />
                  <span className="total">{signed(st.score)}</span>
                </div>
              ))}
            </div>
            <p className="text-ivory-200/70 mt-3 text-center text-sm">{endLine ?? endLineFor(null, final, view.me)}</p>
          </div>
        ) : (
          <div className="standings mt-4">
            <div className="row text-ivory-200/55 text-xs">
              <span />
              <span className="delta">This hand</span>
              <span className="total">Total</span>
            </div>
            {order.map((seat) => (
              <div key={seat} className={`row${seat === view.me ? ' is-me' : ''}`}>
                <span className="who">
                  {names[seat]}
                  {marks?.[seat] === 'bot' && ' · bot'}
                </span>
                <span className="delta">{paid ? signed(deltas[seat]) : ''}</span>
                <span className="total">{signed(scores[seat])}</span>
              </div>
            ))}
          </div>
        )}
        {/* A phone lying down has no height to spare, so there the host's End shares a row with Next hand rather than taking
            more of the room the hand and the scores need. The wait's line goes under Next hand, in its own column. */}
        <div className="bg-felt-900 sticky bottom-0 mt-2 flex flex-col gap-2 pt-2 pb-[calc(20px_+_var(--safe-bottom))] [@media(orientation:landscape)_and_(height<32rem)]:flex-row [@media(orientation:landscape)_and_(height<32rem)]:items-start">
          <div className="w-full">
            <button className="btn btn-primary btn-block" disabled={busy || !!wait?.ready} onClick={onNext}>
              {gameOver ? (nextLabel ?? 'Play again') : (wait?.button ?? 'Next hand')}
            </button>
            {wait?.line && <p className="text-ivory-200/70 mt-2 text-center text-sm">{wait.line}</p>}
          </div>
          {onEndGame && (
            <button className="btn btn-quiet btn-block" disabled={busy} onClick={onEndGame}>
              End the game here
            </button>
          )}
        </div>
      </div>
    </>
  );
}
