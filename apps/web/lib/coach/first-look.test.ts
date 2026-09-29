import { describe, expect, it } from 'vitest';
import type { GameEvent, PrivatePlayerView } from '@society/engine';
import { firstLookFor, joinedAtOf } from './first-look';
import { ROUNDS, playHand } from './test-games';

/** An event as written here: numbered in order by `viewWith`. */
type Move = { readonly type: string; readonly seat: number; readonly tile?: string; readonly secret?: boolean };

/** Enough of seat 0's view for `firstLookFor`: East hand 2, with these events. */
const viewWith = (events: readonly Move[], handIndex = ROUNDS.E1.handIndex) =>
  ({ me: 0, progress: { ...ROUNDS.E1, handIndex }, events: events.map((e, i) => ({ ...e, seq: i + 1 })) }) as unknown as PrivatePlayerView;

/** The bot kept seat 0 for a round of the table, then the person took over at seq 6. */
const beforeTakeOver: readonly Move[] = [
  { type: 'drew', seat: 0, secret: true },
  { type: 'discarded', seat: 0, tile: 'p9' },
  { type: 'drew', seat: 1, secret: true },
  { type: 'discarded', seat: 1, tile: 'WE' },
  { type: 'claimed', seat: 0, tile: 'WE' },
  { type: 'discarded', seat: 0, tile: 's1' },
];
const TOOK = { hand: ROUNDS.E1.handIndex, seq: 6 };

describe('the first look after taking a seat over', () => {
  it('lasts from the take-over, whatever the bot did with the seat before it, while the others move and the person draws', () => {
    expect(firstLookFor(viewWith(beforeTakeOver), TOOK)).toBe(true);
    const others = [...beforeTakeOver, { type: 'drew', seat: 1, secret: true }, { type: 'discarded', seat: 1, tile: 's2' }, { type: 'drew', seat: 0 }];
    expect(firstLookFor(viewWith(others), TOOK)).toBe(true);
    // A flower and its replacement are the wall's doing, not a move of theirs.
    expect(firstLookFor(viewWith([...others, { type: 'bonus', seat: 0, tile: 'F1' }, { type: 'replacement', seat: 0 }]), TOOK)).toBe(true);
    // Someone else's claim isn't theirs either.
    expect(firstLookFor(viewWith([...others, { type: 'claimed', seat: 2, tile: 's2' }]), TOOK)).toBe(true);
  });

  it('ends with their own first discard, claim or kong', () => {
    expect(firstLookFor(viewWith([...beforeTakeOver, { type: 'drew', seat: 0 }, { type: 'discarded', seat: 0, tile: 'p1' }]), TOOK)).toBe(false);
    expect(firstLookFor(viewWith([...beforeTakeOver, { type: 'discarded', seat: 1, tile: 's2' }, { type: 'claimed', seat: 0, tile: 's2' }]), TOOK)).toBe(false);
    expect(firstLookFor(viewWith([...beforeTakeOver, { type: 'drew', seat: 0 }, { type: 'kong', seat: 0, tile: 'm3' }]), TOOK)).toBe(false);
  });

  it('belongs to the hand it was taken over in, and to a take-over at all', () => {
    expect(firstLookFor(viewWith(beforeTakeOver, ROUNDS.E1.handIndex + 1), TOOK)).toBe(false);
    expect(firstLookFor(viewWith(beforeTakeOver), null)).toBe(false);
    expect(firstLookFor(viewWith(beforeTakeOver), undefined)).toBe(false);
  });

  it('follows a hand the reducer plays: from a take-over part-way through to the move after it', () => {
    let took: { hand: number; seq: number } | null = null;
    const looks: { seq: number; first: boolean; mine: boolean }[] = [];
    playHand({
      seed: 'first-look',
      progress: ROUNDS.E1,
      onView: (view) => {
        const moved = (e: GameEvent) => e.seat === 0 && ['discarded', 'claimed', 'kong'].includes(e.type);
        // Taken over once the seat has moved twice (so the bot's moves are there to be ignored), on someone else's turn.
        if (!took && view.events.filter(moved).length >= 2 && view.phase === 'turn' && view.turn !== 0) took = { hand: view.progress.handIndex, seq: view.seq };
        if (took) looks.push({ seq: view.seq, first: firstLookFor(view, took), mine: view.events.some((e) => e.seq > took!.seq && moved(e)) });
      },
    });
    expect(took).not.toBeNull();
    expect(looks[0]).toMatchObject({ first: true, mine: false });
    // True exactly until the seat's first move of its own after the take-over, and never again in the hand.
    for (const look of looks) expect(look.first, `seq ${look.seq}`).toBe(!look.mine);
    expect(looks.some((x) => !x.first)).toBe(true);
  });
});

describe("a snapshot's joinedAt", () => {
  it('is read as a hand and a seq', () => {
    expect(joinedAtOf({ gameId: 'g', joinedAt: { hand: 1, seq: 42 } })).toEqual({ hand: 1, seq: 42 });
  });

  it("is null when the table sends none, or sends something that isn't one", () => {
    for (const snapshot of [
      null,
      undefined,
      {},
      { joinedAt: null },
      { joinedAt: 7 },
      { joinedAt: { hand: 1 } },
      { joinedAt: { hand: '1', seq: 2 } },
      { joinedAt: { hand: 1, seq: 2.5 } },
    ])
      expect(joinedAtOf(snapshot), JSON.stringify(snapshot)).toBeNull();
  });
});
