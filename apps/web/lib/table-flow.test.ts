import { describe, expect, it } from 'vitest';
import { SEATS, karachi, legalActions, reduce, simpleBot, startHand, viewFor, type HandState, type Seat } from '@society/engine';
import { tableFlow } from './table-flow';

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
