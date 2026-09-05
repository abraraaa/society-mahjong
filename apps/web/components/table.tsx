'use client';
import { useMemo, useState } from 'react';
import { acrossFrom, leftOf, rightOf, tileName, type Action, type PrivatePlayerView, type Seat, type TileKind } from '@society/engine';
import { Tile } from '@/components/tile';
import { SeatPill } from '@/components/seat-pill';
import { ClaimSheet } from '@/components/claim-sheet';
import { Coach, CoachLine, TermProvider, useOpenTerm } from '@/components/coach';
import { River } from '@/components/river';
import { riverOrder } from '@/lib/river';
import { NO_SCORES, handDeltas, signed, standings, type Scores } from '@/lib/ledger';
import type { CoachState } from '@/lib/coach';

/** What a seat can send: every engine action except the server's own `resolveClaims`. */
export type SeatAction = Exclude<Action, { type: 'resolveClaims' }>;

/** Custom properties are not part of React's CSSProperties, so name the one we set. */
type HandStyle = React.CSSProperties & { '--hand-n'?: number };

/** Every kind is in the wall four times, which is what makes "already dead" answerable. */
const COPIES = 4;

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
  /** the live table's ticking clock: whose deadline is running and how long is left */
  readonly clock?: { readonly kind: 'turn' | 'claim'; readonly ms: number } | null;
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
}: TableProps) {
  const ME = view.me;
  const openTerm = useOpenTerm();
  const counter = `${ROUND_NAME[view.progress.roundWind] ?? view.progress.roundWind} round · hand ${view.progress.handInRound + 1} of ${handsPerRound} · wall ${view.wallRemaining}`;
  const sub = subtitle ? `${subtitle} · ${counter}` : counter;
  const me = view.players[ME];
  const legal = view.legal;
  const [selected, setSelected] = useState<TileKind | null>(null);

  const act = (a: SeatAction) => {
    setSelected(null);
    onAct(a);
  };

  const myTurn = view.phase === 'turn' && view.turn === ME && !!legal.discard;
  const advice = tutorOn ? coach : null;
  const suggested = advice && advice.action.kind === 'discard' ? advice.action.tile : null;
  const hasActions = !!legal.win || !!legal.kong?.length || (myTurn && (selected !== null || suggested !== null));
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
      <p className="label whitespace-nowrap">{selected ? `${selectedOut} of ${COPIES} out` : `${riverTiles.length} discarded`}</p>
    </div>
  );
  const river = <River tiles={riverTiles} claimable={view.phase === 'claim'} highlight={selected} />;

  const bubble = advice ? <Coach plan={advice.plan} say={advice.say} stage={coach.stage} /> : null;

  const actions = (
    <>
      {legal.win && (
        <button className="btn btn-gold" onClick={() => act({ type: 'declareWin', seat: ME })}>
          Mahjong!
        </button>
      )}
      {legal.kong?.map((k) => (
        <button key={k} className="btn btn-ghost" onClick={() => act({ type: 'declareKong', seat: ME, tile: k })}>
          Kong {tileName(k)}
        </button>
      ))}
      {myTurn &&
        (selected ? (
          <button className="btn btn-primary" onClick={() => act({ type: 'discard', seat: ME, tile: selected })}>
            Discard {tileName(selected)}
          </button>
        ) : suggested ? (
          <button className="btn btn-primary" onClick={() => act({ type: 'discard', seat: ME, tile: suggested })}>
            Discard {tileName(suggested)}
          </button>
        ) : null)}
    </>
  );

  const handTiles = (size: 'md' | 'lg') =>
    view.concealed.map((k, i) => {
      const isDrawn = i === drawnIndex && myTurn;
      return (
        <Tile
          key={`${k}-${i}`}
          kind={k}
          size={size}
          // Always selectable: a tap while the bots are still moving lifts the
          // tile and reads the river for it; the discard button waits for the turn.
          selectable
          selected={selected === k}
          fresh={isDrawn}
          coached={!!advice && advice.highlight.includes(k) && selected !== k}
          className={isDrawn ? 'drawn' : undefined}
          onClick={() => setSelected(selected === k ? null : k)}
        />
      );
    });

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
      {...(orientation ? { orientation } : {})}
    />
  );

  const claimOpen = view.phase === 'claim' && !!legal.claims && legal.claims.length > 0 && !!view.lastDiscard;

  // The line above the hand that says whose clock is running, when it is
  // mine or when I am waiting on someone else's claim. A bot's clock never
  // runs: the server plays it inline.
  let clockLine: string | null = null;
  if (clock) {
    if (clock.kind === 'turn' && view.phase === 'turn' && view.turn === ME) clockLine = `Your turn · ${mmss(clock.ms)}`;
    else if (clock.kind === 'turn' && view.phase === 'preplay' && legal.exchange) clockLine = `Your exchange · ${mmss(clock.ms)}`;
    else if (clock.kind === 'claim' && view.phase === 'claim' && !claimOpen) {
      const waiting = view.players.filter((p) => p.seat !== ME && p.seat !== view.lastDiscard?.from && !p.responded).map((p) => names[p.seat]);
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

        {hasActions && <div className="action-row flex-none">{actions}</div>}

        <section className="hand-dock flex-none">
          {clockEl}
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
          {me.melds.length > 0 && myMelds}
          <div className="hand-rail" style={handStyle}>
            {handTiles('lg')}
          </div>
          {me.bonus.length > 0 && bonus}
          {hasActions && <div className="action-row">{actions}</div>}
        </div>
      </div>

      {claimOpen && view.lastDiscard && (
        <ClaimSheet
          discardKind={view.lastDiscard.kind}
          discarderName={names[view.lastDiscard.from]}
          coach={coach}
          options={legal.claims!}
          onClaim={(claim) => act({ type: 'claim', seat: ME, claim })}
          onPass={() => act({ type: 'pass', seat: ME })}
          {...(claimMs ? { claimMs: Math.max(1000, claimMs), clock: 'server' as const } : {})}
        />
      )}

      {view.phase === 'preplay' && legal.exchange && (
        // Keyed on the event sequence: each of the three passes (right, across,
        // left) gets a fresh sheet, so picks from the last pass cannot linger and
        // swallow the taps of the next.
        <ExchangeSheet key={view.seq} hand={view.concealed} count={legal.exchange.count} coach={coach} onDone={(tiles) => act({ type: 'exchange', seat: ME, tiles })} />
      )}

      {view.phase === 'finished' && <ResultSheet coach={coach} gameOver={!!gameOver} onNext={onNextHand} view={view} names={names} scores={scores} />}
    </>
  );
}

function ExchangeSheet({ hand, count, coach, onDone }: { hand: readonly TileKind[]; count: number; coach: CoachState; onDone: (tiles: TileKind[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  // The coach has already worked out which tiles no candidate hand is using; the
  // player can overrule it, but the sheet opens on its answer rather than empty.
  const suggested = coach.action.kind === 'exchange' ? coach.action.tiles : [];
  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        <h2 className="font-display mb-1 text-xl">Goulash exchange</h2>
        <p className="text-ivory-200/70 mb-3 text-sm">
          Choose {count} tiles to pass. <CoachLine say={coach.say} />
        </p>
        <div className="flex flex-wrap justify-center gap-1">
          {hand.map((k, i) => (
            <Tile
              key={i}
              kind={k}
              size="md"
              selectable
              selected={picked.includes(i)}
              coached={picked.length === 0 && suggested.includes(k)}
              onClick={() => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < count ? [...p, i] : p))}
            />
          ))}
        </div>
        <button className="btn btn-primary btn-block mt-3" disabled={picked.length !== count} onClick={() => onDone(picked.map((i) => hand[i]!))}>
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
 * is over it becomes the final table.
 */
function ResultSheet({
  coach,
  gameOver,
  onNext,
  view,
  names,
  scores,
}: {
  coach: CoachState;
  gameOver: boolean;
  onNext: () => void;
  view: PrivatePlayerView;
  names: Readonly<Record<Seat, string>>;
  scores: Scores;
}) {
  const outcome = coach.outcome;
  const deltas = handDeltas(view.result);
  const order = standings(scores);
  const paid = view.result?.type === 'win';
  return (
    <>
      <div className="scrim" />
      <div className="sheet">
        <div className="grabber" />
        <h2 className="font-display mb-2 text-xl">{outcome?.type === 'win' ? (outcome.winnerIsMe ? 'Mahjong!' : `${outcome.winnerName} wins`) : 'Washed out'}</h2>
        {outcome?.tiles && outcome.tiles.length > 0 && (
          <div className="mb-3 flex flex-wrap justify-center gap-1">
            {outcome.tiles.map((k, i) => (
              <Tile key={i} kind={k} size="xs" />
            ))}
          </div>
        )}
        <p className="text-ivory-100/90 text-sm">
          <CoachLine say={coach.say} />
        </p>
        <div className="standings mt-4">
          {order.map((seat) => (
            <div key={seat} className={`row${seat === view.me ? ' is-me' : ''}`}>
              <span className="who">{names[seat]}</span>
              <span className="delta">{paid ? signed(deltas[seat]) : ''}</span>
              <span className="total">{signed(scores[seat])}</span>
            </div>
          ))}
        </div>
        {gameOver && <p className="text-ivory-200/70 mt-3 text-center text-sm">That was the last hand of the North round. Final table above.</p>}
        <button className="btn btn-primary btn-block mt-4" onClick={onNext}>
          {gameOver ? 'Play again' : 'Next hand'}
        </button>
      </div>
    </>
  );
}
