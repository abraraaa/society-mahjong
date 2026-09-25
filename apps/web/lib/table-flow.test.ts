import { describe, expect, it } from 'vitest';
import {
  SEATS,
  karachi,
  legalActions,
  nextHand,
  reduce,
  simpleBot,
  startHand,
  viewFor,
  type Action,
  type HandState,
  type PrivatePlayerView,
  type Seat,
  type TileKind,
} from '@society/engine';
import {
  LIFT_SETTLE_MS,
  SETTLE_MS,
  alwaysLegalMove,
  discardOffer,
  discardRefusal,
  handBoundary,
  heldSelection,
  playFor,
  refusalMessage,
  selectTile,
  selectionEpoch,
  settling,
  standInNotice,
  tableFlow,
  tryReduce,
  type Refusal,
  type Selection,
} from './table-flow';

const ME: Seat = 0;
const progress = { roundWind: 'E' as const, roundIndex: 0, handInRound: 1, handIndex: 1 };

function botStep(state: HandState): HandState {
  let s = state;
  for (const seat of SEATS) {
    if (seat === ME || s.phase === 'finished') continue;
    const a = simpleBot(viewFor(s, karachi, seat));
    if (a) s = reduce(s, a, karachi);
  }
  return s;
}

/** Drive the table the way solo-table.tsx does, with a scripted player, until `until` holds. */
function drive(state: HandState, until: (s: HandState) => boolean, steps = 400): HandState {
  let s = state;
  for (let i = 0; i < steps && !until(s); i++) {
    const legal = legalActions(s, karachi, ME);
    switch (tableFlow(s, legal, ME)) {
      case 'over':
        return s;
      case 'auto-pass':
        s = reduce(s, { type: 'pass', seat: ME }, karachi);
        break;
      case 'mine':
        if (legal.exchange) s = reduce(s, { type: 'exchange', seat: ME, tiles: s.players[ME].concealed.slice(0, legal.exchange.count) }, karachi);
        else if (legal.claims) s = reduce(s, { type: 'pass', seat: ME }, karachi);
        else if (legal.discard) s = reduce(s, { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! }, karachi);
        else throw new Error('unexpected move');
        break;
      case 'bots':
        s = botStep(s);
        break;
    }
  }
  return s;
}

/** A bot's discard that another bot can claim while the player holds nothing claimable. */
const emptyWindowForMe = (s: HandState) =>
  s.phase === 'claim' && s.lastDiscard?.from !== ME && s.claims[ME] === undefined && legalActions(s, karachi, ME).claims?.length === 0;

describe('tableFlow', () => {
  it('answers a claim window with nothing claimable on the player’s behalf', () => {
    // Search seeds for the situation; it is common but not guaranteed on a given deal.
    let found: HandState | null = null;
    for (let i = 0; i < 40 && !found; i++) {
      const s = drive(startHand(karachi, { seed: `flow-${i}`, progress, dealer: 1 }), emptyWindowForMe);
      if (emptyWindowForMe(s)) found = s;
    }
    expect(found, 'no seed produced a claimable-by-a-bot-only discard').not.toBeNull();
    const s = found!;
    const legal = legalActions(s, karachi, ME);
    expect(legal.claims).toEqual([]);
    // The old table treated `[]` as "my move", hid the sheet, and stopped the bots: a stall.
    expect(tableFlow(s, legal, ME)).toBe('auto-pass');
    // After the pass the window either resolves or waits on the bots — never on us.
    const after = reduce(s, { type: 'pass', seat: ME }, karachi);
    expect(tableFlow(after, legalActions(after, karachi, ME), ME)).not.toBe('auto-pass');
    expect(tableFlow(after, legalActions(after, karachi, ME), ME)).not.toBe('mine');
  });

  it('plays a whole hand through without stalling', () => {
    const end = drive(startHand(karachi, { seed: 'flow-whole', progress, dealer: 1 }), (s) => s.phase === 'finished', 2000);
    expect(end.phase).toBe('finished');
  });

  it('opens the sheet only when there is something to claim', () => {
    const s = startHand(karachi, { seed: 'flow-0', progress, dealer: 1 });
    const turnState = drive(s, (x) => x.phase === 'turn' && x.turn === ME);
    expect(tableFlow(turnState, legalActions(turnState, karachi, ME), ME)).toBe('mine');
  });
});

const view = (s: HandState): PrivatePlayerView => viewFor(s, karachi, ME);
const step = (s: HandState): HandState => drive(s, () => false, 1);
const myTurn = (s: HandState) => s.phase === 'turn' && s.turn === ME;
const myDiscards = (s: HandState) => s.events.filter((e) => e.type === 'discarded' && e.seat === ME).length;
/** Mid-hand, after the player's first discard, with someone else to move. */
const botsMoving = (s: HandState) => s.phase === 'turn' && s.turn !== ME && myDiscards(s) > 0;

describe('selection', () => {
  const s0 = drive(startHand(karachi, { seed: 'pick-0', progress, dealer: 1 }), botsMoving);
  const v0 = view(s0);
  const kind = v0.concealed[0]!;
  const pick = selectTile(kind, v0);

  it('keeps a tile lifted during the bots’ moves until the player’s turn, then drops it once that turn is over', () => {
    expect(botsMoving(s0)).toBe(true);
    expect(heldSelection(pick, v0)).toBe(kind);
    // Not the player's turn: the lifted tile reads the river, but nothing is offered to discard.
    expect(discardOffer(v0, kind, null)).toBeNull();

    const s1 = drive(s0, (s) => myTurn(s) || s.phase === 'finished');
    expect(myTurn(s1)).toBe(true);
    const v1 = view(s1);
    expect(heldSelection(pick, v1)).toBe(kind);
    expect(discardOffer(v1, kind, v1.concealed[1]!)).toBe(kind);

    // The turn ends on a different tile (or a bot standing in): the pick goes with it, though the tile is still held.
    const other = v1.concealed.find((k) => k !== kind)!;
    const v2 = view(reduce(s1, { type: 'discard', seat: ME, tile: other }, karachi));
    expect(v2.concealed).toContain(kind);
    expect(heldSelection(pick, v2)).toBeNull();
  });

  it('drops a pick when the hand changes, even when the new hand holds the same tile', () => {
    const next: PrivatePlayerView = { ...v0, progress: { ...v0.progress, handIndex: v0.progress.handIndex + 1 } };
    expect(next.concealed).toContain(kind);
    expect(heldSelection(pick, next)).toBeNull();
  });

  it('drops a pick when the hand finishes', () => {
    expect(heldSelection(pick, { ...v0, phase: 'finished' })).toBeNull();
  });

  it('drops a pick once the tile has left the hand', () => {
    expect(heldSelection(pick, { ...v0, concealed: v0.concealed.filter((k) => k !== kind) })).toBeNull();
  });

  it('counts a discard of the player’s that someone claimed, though it has left the river', () => {
    const claimed: PrivatePlayerView = { ...v0, events: [...v0.events, { seq: v0.seq + 1, type: 'discarded', seat: ME, tile: kind }] };
    expect(claimed.players[ME].discards).toEqual(v0.players[ME].discards);
    expect(selectionEpoch(claimed)).not.toBe(selectionEpoch(v0));
    expect(heldSelection(pick, claimed)).toBeNull();
  });

  it('has nothing to drop when nothing is lifted', () => {
    expect(heldSelection(null, v0)).toBeNull();
  });
});

describe('discardOffer', () => {
  const s = drive(startHand(karachi, { seed: 'offer-0', progress, dealer: 1 }), (x) => myTurn(x) && myDiscards(x) > 0);
  const v = view(s);
  const held = v.concealed[0]!;
  const tutor = v.concealed[v.concealed.length - 1]!;
  const missing = (['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as TileKind[]).find((k) => !v.concealed.includes(k))!;

  it('offers the player’s own pick over the tutor’s', () => {
    expect(discardOffer(v, held, tutor)).toBe(held);
  });

  it('falls back to the tutor’s tile when the pick is not in the hand', () => {
    expect(discardOffer(v, missing, tutor)).toBe(tutor);
  });

  it('offers nothing rather than a tile the player does not hold', () => {
    expect(discardOffer(v, missing, null)).toBeNull();
    expect(discardOffer(v, null, missing)).toBeNull();
    // the engine's own list is not enough on its own: the tile has to be in the hand too
    expect(discardOffer({ ...v, legal: { ...v.legal, discard: [...v.legal.discard!, missing] } }, missing, null)).toBeNull();
  });

  it('offers nothing out of turn', () => {
    expect(discardOffer({ ...v, turn: 1 }, held, tutor)).toBeNull();
    expect(discardOffer({ ...v, phase: 'claim' }, held, tutor)).toBeNull();
  });
});

describe('tryReduce', () => {
  const s = drive(startHand(karachi, { seed: 'try-0', progress, dealer: 1 }), (x) => myTurn(x) && myDiscards(x) > 0);
  const held = s.players[ME].concealed[0]!;
  const missing = (['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'] as TileKind[]).find((k) => !s.players[ME].concealed.includes(k))!;

  it('plays a move the engine takes', () => {
    const next = tryReduce(s, { type: 'discard', seat: ME, tile: held }, karachi);
    expect(next).not.toBeNull();
    expect(myDiscards(next!)).toBe(myDiscards(s) + 1);
  });

  it('turns the engine’s refusal into null instead of a throw', () => {
    const tap = { type: 'discard', seat: ME, tile: missing } as const;
    // What took the solo page down: the engine throws 'tile … not in hand' inside the state update.
    expect(() => reduce(s, tap, karachi)).toThrow(/not in hand/);
    expect(tryReduce(s, tap, karachi)).toBeNull();
    expect(tryReduce(s, { type: 'discard', seat: 1, tile: held }, karachi)).toBeNull();
  });
});

describe('a pick carried over a hand boundary', () => {
  it('is dropped, so the next hand never offers a tile the player does not hold', () => {
    let carriedAndMissing = 0;
    for (let g = 0; g < 40; g++) {
      // Play a hand out, lifting a tile during the bots' moves after the player's last discard.
      let s = startHand(karachi, { seed: `carry-${g}`, progress, dealer: 1 });
      let pick: Selection | null = null;
      while (s.phase !== 'finished') {
        if (!myTurn(s) && s.phase !== 'preplay' && heldSelection(pick, view(s)) === null) pick = selectTile(view(s).concealed.at(-1)!, view(s));
        const before = myDiscards(s);
        s = step(s);
        if (myDiscards(s) !== before) pick = null; // the player's discard goes through act(), which clears it
      }
      const n = nextHand(s, karachi);
      if (!pick || !n) continue;
      const t = drive(startHand(karachi, { seed: `carry-${g}`, ...n }), (x) => myTurn(x) || x.phase === 'finished');
      if (!myTurn(t)) continue;
      const vt = view(t);
      expect(heldSelection(pick, vt)).toBeNull();
      const offer = discardOffer(vt, heldSelection(pick, vt), vt.legal.discard![0]!);
      expect(offer).not.toBeNull();
      expect(vt.concealed).toContain(offer);
      if (!vt.concealed.includes(pick.kind)) {
        carriedAndMissing++;
        expect(offer).not.toBe(pick.kind);
        expect(tryReduce(t, { type: 'discard', seat: ME, tile: pick.kind }, karachi)).toBeNull();
      }
    }
    expect(carriedAndMissing, 'no seed carried a pick into a hand without that tile').toBeGreaterThan(0);
  });
});

describe('the grace period after a hand boundary', () => {
  const s0 = startHand(karachi, { seed: 'grace-0', progress, dealer: 1 });

  it('starts again when a hand is dealt and when it finishes, and at no other time', () => {
    const playing = drive(s0, botsMoving);
    // Discards, claims and turns within the hand are not a boundary.
    expect(handBoundary(view(playing))).toBe(handBoundary(view(s0)));
    const finished = drive(s0, (s) => s.phase === 'finished', 2000);
    expect(handBoundary(view(finished))).not.toBe(handBoundary(view(playing)));
    const next = startHand(karachi, { seed: 'grace-0', ...nextHand(finished, karachi)! });
    expect(handBoundary(view(next))).not.toBe(handBoundary(view(finished)));
    expect(handBoundary(view(next))).not.toBe(handBoundary(view(s0)));
  });

  it('swallows the second tap of a double tap on Next hand, and nothing a person means', () => {
    const dealtAt = 10_000; // the first tap dealt the new hand
    expect(settling(dealtAt, dealtAt + 120)).toBe(true);
    expect(settling(dealtAt, dealtAt + SETTLE_MS - 1)).toBe(true);
    expect(settling(dealtAt, dealtAt + SETTLE_MS)).toBe(false);
    expect(settling(dealtAt, dealtAt + 2000)).toBe(false);
    expect(SETTLE_MS).toBeLessThanOrEqual(500);
  });

  it('lets a tile be lifted sooner than a move is taken, but not on the second tap of a double tap', () => {
    const dealtAt = 10_000;
    expect(settling(dealtAt, dealtAt + 120, LIFT_SETTLE_MS)).toBe(true);
    expect(settling(dealtAt, dealtAt + LIFT_SETTLE_MS, LIFT_SETTLE_MS)).toBe(false);
    expect(LIFT_SETTLE_MS).toBeLessThan(SETTLE_MS);
  });
});

describe('alwaysLegalMove', () => {
  const west = startHand(karachi, { seed: 'legal-west', progress: { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 }, dealer: 1 });
  const claimWindow = drive(startHand(karachi, { seed: 'legal-claim', progress, dealer: 1 }), (s) => s.phase === 'claim' && s.lastDiscard?.from !== 2 && s.claims[2] === undefined);

  it('passes the first tiles in hand for an exchange', () => {
    expect(west.phase).toBe('preplay');
    const move = alwaysLegalMove(viewFor(west, karachi, 2));
    expect(move).toEqual({ type: 'exchange', seat: 2, tiles: west.players[2].concealed.slice(0, 3) });
    expect(tryReduce(west, move!, karachi)).not.toBeNull();
  });

  it('passes in a claim window', () => {
    expect(claimWindow.phase).toBe('claim');
    const move = alwaysLegalMove(viewFor(claimWindow, karachi, 2));
    expect(move).toEqual({ type: 'pass', seat: 2 });
    expect(tryReduce(claimWindow, move!, karachi)).not.toBeNull();
  });

  it('discards the first tile it may on its turn', () => {
    const turn = drive(startHand(karachi, { seed: 'legal-turn', progress, dealer: 1 }), (s) => s.phase === 'turn' && s.turn === 2);
    const v = viewFor(turn, karachi, 2);
    const move = alwaysLegalMove(v);
    expect(move).toEqual({ type: 'discard', seat: 2, tile: v.legal.discard![0] });
    expect(tryReduce(turn, move!, karachi)).not.toBeNull();
  });

  it('has nothing when the table is not waiting on the seat', () => {
    const turn = drive(startHand(karachi, { seed: 'legal-turn', progress, dealer: 1 }), (s) => s.phase === 'turn' && s.turn === 2);
    expect(alwaysLegalMove(viewFor(turn, karachi, 3))).toBeNull();
    expect(alwaysLegalMove(viewFor({ ...turn, phase: 'finished' }, karachi, 2))).toBeNull();
  });
});

describe('playFor: the solo table never freezes on a refused bot move', () => {
  const BOTS: Seat[] = [1, 2, 3];
  const collect = () => {
    const refusals: Refusal[] = [];
    return { refusals, refused: (r: Refusal) => refusals.push(r) };
  };
  const turn = drive(startHand(karachi, { seed: 'play-turn', progress, dealer: 1 }), (s) => s.phase === 'turn' && s.turn === 2);
  const notHeld = (s: HandState, seat: Seat) =>
    (['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 'm1', 'm2'] as TileKind[]).find((k) => !s.players[seat].concealed.includes(k))!;

  it('plays the bot’s own move when the engine takes it, and says nothing', () => {
    const { refusals, refused } = collect();
    const tile = turn.players[2].concealed.at(-1)!;
    const after = playFor(turn, [2], karachi, () => ({ type: 'discard', seat: 2, tile }), refused);
    expect(after.players[2].discards.at(-1) ?? after.lastDiscard?.kind).toBe(tile);
    expect(refusals).toEqual([]);
  });

  it('replaces a refused move with the first legal discard, and reports it', () => {
    const { refusals, refused } = collect();
    const bad: Action = { type: 'discard', seat: 2, tile: notHeld(turn, 2) };
    // The old step kept the state whenever the engine refused: the table sat there for good.
    expect(tryReduce(turn, bad, karachi)).toBeNull();
    const after = playFor(turn, [2], karachi, () => bad, refused);
    expect(after).not.toBe(turn);
    expect(after.events.some((e) => e.seq > turn.seq && e.type === 'discarded' && e.seat === 2 && e.tile === viewFor(turn, karachi, 2).legal.discard![0])).toBe(true);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({ seat: 2, tried: bad, instead: { type: 'discard', seat: 2 }, why: expect.stringMatching(/not in hand/) });
  });

  it('stands in when a bot chooses nothing though the table is waiting on it', () => {
    const { refusals, refused } = collect();
    const after = playFor(turn, [2], karachi, () => null, refused);
    expect(after).not.toBe(turn);
    expect(refusals).toMatchObject([{ seat: 2, tried: null, why: 'nothing was chosen' }]);
  });

  it('plays a whole hand through with bots that only ever choose nonsense', () => {
    const { refusals, refused } = collect();
    let s = startHand(karachi, { seed: 'play-nonsense', progress, dealer: 1 });
    const nonsense = (v: PrivatePlayerView): Action => ({ type: 'discard', seat: v.me, tile: notHeld(s, v.me) });
    for (let i = 0; i < 2000 && s.phase !== 'finished'; i++) {
      const legal = legalActions(s, karachi, ME);
      if (tableFlow(s, legal, ME) === 'bots') s = playFor(s, BOTS, karachi, nonsense, refused);
      else if (legal.exchange) s = reduce(s, { type: 'exchange', seat: ME, tiles: s.players[ME].concealed.slice(0, legal.exchange.count) }, karachi);
      else if (legal.pass) s = reduce(s, { type: 'pass', seat: ME }, karachi);
      else if (legal.discard) s = reduce(s, { type: 'discard', seat: ME, tile: s.players[ME].concealed[0]! }, karachi);
    }
    expect(s.phase).toBe('finished');
    expect(refusals.length).toBeGreaterThan(0);
  });

  it('leaves the table alone when no seat is due to move', () => {
    const { refusals, refused } = collect();
    const mine = drive(startHand(karachi, { seed: 'play-mine', progress, dealer: 1 }), (s) => s.phase === 'turn' && s.turn === ME);
    expect(playFor(mine, BOTS, karachi, () => null, refused)).toBe(mine);
    expect(refusals).toEqual([]);
  });

  it('throws rather than sit there when even the stand-in move is refused', () => {
    const { refusals, refused } = collect();
    const west = startHand(karachi, { seed: 'play-west', progress: { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 }, dealer: 1 });
    // A seat with no tiles to pass: nothing it could send would be taken.
    const broken: HandState = { ...west, players: west.players.map((p, i) => (i === 2 ? { ...p, concealed: [] } : p)) as unknown as HandState['players'] };
    expect(() => playFor(broken, [2], karachi, () => null, refused)).toThrow(/stalled/);
    expect(refusals).toHaveLength(1);
  });
});

describe('refusalMessage', () => {
  it('says which seat, what it tried, why it was refused and what it played', () => {
    const r: Refusal = { seat: 2, tried: { type: 'discard', seat: 2, tile: 's9' }, instead: { type: 'discard', seat: 2, tile: 'm1' }, why: 'tile not in hand' };
    expect(refusalMessage(r)).toBe("solo table: seat 2's discard s9 was refused (tile not in hand), so it played discard m1 instead");
    expect(refusalMessage({ seat: 3, tried: null, instead: { type: 'pass', seat: 3 }, why: 'nothing was chosen' })).toBe(
      'solo table: seat 3 chose no move though one was due, so it played pass instead',
    );
  });
});

describe('standInNotice', () => {
  it('says a bot moved for the player, never a stand-in', () => {
    const lines = [
      standInNotice({ type: 'discard', seat: ME, tile: 'm7' }),
      standInNotice({ type: 'pass', seat: ME }),
      standInNotice({ type: 'claim', seat: ME, claim: { type: 'pung', tiles: ['m7', 'm7'] } }),
      standInNotice({ type: 'claim', seat: ME, claim: { type: 'win' } }),
      standInNotice({ type: 'exchange', seat: ME, tiles: ['m1', 'm2', 'm3'] }),
      standInNotice({ type: 'declareWin', seat: ME }),
      standInNotice({ type: 'declareKong', seat: ME, tile: 'm7' }),
      standInNotice({ type: 'resolveClaims' }),
    ];
    for (const line of lines) {
      expect(line).toMatch(/\ba bot\b/);
      expect(line).not.toMatch(/stand-in/);
    }
  });

  it('names one tile as one tile', () => {
    expect(standInNotice({ type: 'discard', seat: ME, tile: 'm7' })).toBe('You ran out of time, so a bot discarded the 7 Characters for you.');
  });

  it('says plainly that a bot called or declared the Mahjong', () => {
    expect(standInNotice({ type: 'claim', seat: ME, claim: { type: 'win' } })).toBe('Time ran out, so a bot called Mahjong for you.');
    expect(standInNotice({ type: 'declareWin', seat: ME })).toBe('Time ran out, so a bot declared your Mahjong.');
  });
});

describe('discardRefusal', () => {
  const turn = (t: Seat) => ({ me: ME, phase: 'turn' as const, turn: t });

  it("on the player's turn, names the one tile that has gone and asks for another", () => {
    expect(discardRefusal(turn(ME), 'm7')).toBe("You're not holding the 7 Characters any more. Pick another tile to discard.");
    expect(discardRefusal(turn(ME), 'DR')).toBe("You're not holding the Red Dragon any more. Pick another tile to discard.");
  });

  it('otherwise, says to wait for the turn to come round', () => {
    const wait = "It's not your turn to discard yet. Hang on until it comes round to you.";
    expect(discardRefusal(turn(2), 'm7')).toBe(wait);
    expect(discardRefusal({ me: ME, phase: 'claim', turn: ME }, 'm7')).toBe(wait);
    expect(discardRefusal(null, 'm7')).toBe(wait);
  });
});
