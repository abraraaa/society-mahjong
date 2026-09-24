import { describe, expect, it } from 'vitest';
import { SEATS, analysisBot, karachi, legalActions, reduce, startHand, viewFor, type Action, type GameProgress, type HandState } from '@society/engine';
import { CLIENT_ACTION_TYPES, PLAYER_ACTION_TYPES } from './types';
import { MAX_NAME_LENGTH, cleanDisplayName, isUuid, parseClaim, parseClientAction, parseRoomOptions, parseRoomRequest, parseSeat, parseTile } from './validate';

/** What the route sees: the action after a trip through JSON. */
const wire = (x: unknown): unknown => JSON.parse(JSON.stringify(x));

describe('parseClientAction', () => {
  it('accepts every move a player can make, exactly as the table builds it', () => {
    const legit = [
      { type: 'exchange', seat: 0, tiles: ['m1', 'p5', 'WE'] },
      { type: 'discard', seat: 1, tile: 's9' },
      { type: 'declareKong', seat: 2, tile: 'DR' },
      { type: 'declareWin', seat: 3 },
      { type: 'claim', seat: 1, claim: { type: 'chow', tiles: ['m2', 'm3'] } },
      { type: 'claim', seat: 2, claim: { type: 'pung', tiles: ['p7', 'p7'] } },
      { type: 'claim', seat: 3, claim: { type: 'kong', tiles: ['WN', 'WN', 'WN'] } },
      { type: 'claim', seat: 0, claim: { type: 'win' } },
      { type: 'pass', seat: 2 },
      { type: 'nextHand' },
    ];
    for (const a of legit) expect(parseClientAction(wire(a)), JSON.stringify(a)).toEqual(a);
    // Every type a client may send is covered above.
    expect(new Set(legit.map((a) => a.type))).toEqual(new Set(CLIENT_ACTION_TYPES));
  });

  it('refuses resolveClaims, even carrying the caller’s own seat', () => {
    expect(parseClientAction({ type: 'resolveClaims' })).toBeNull();
    for (const seat of SEATS) expect(parseClientAction({ type: 'resolveClaims', seat })).toBeNull();
    expect(CLIENT_ACTION_TYPES).not.toContain('resolveClaims');
    expect(PLAYER_ACTION_TYPES).not.toContain('resolveClaims');
  });

  it('refuses unknown types and anything that is not an action at all', () => {
    for (const bad of [
      null,
      undefined,
      'discard',
      7,
      [],
      ['discard'],
      {},
      { seat: 0 },
      { type: 'Discard', seat: 0, tile: 'm1' },
      { type: 'deal', seat: 0 },
      { type: 'toString', seat: 0 },
      { type: '__proto__', seat: 0 },
    ]) {
      expect(parseClientAction(bad), JSON.stringify(bad) ?? String(bad)).toBeNull();
    }
  });

  it('refuses a seat that is not an integer from 0 to 3', () => {
    for (const seat of [-1, 4, 1.5, '1', null, undefined, NaN, Infinity, true, [0]]) {
      expect(parseClientAction({ type: 'pass', seat }), String(seat)).toBeNull();
      expect(parseClientAction({ type: 'discard', seat, tile: 'm1' }), String(seat)).toBeNull();
    }
    expect(parseSeat(0)).toBe(0);
    expect(parseSeat(3)).toBe(3);
  });

  it('refuses tiles the engine does not have', () => {
    for (const tile of ['m0', 'm10', 'z1', 'M1', 'we', '', ' m1', 'm1 ', 1, null, undefined, ['m1'], { kind: 'm1' }]) {
      expect(parseClientAction({ type: 'discard', seat: 0, tile }), JSON.stringify(tile) ?? 'undefined').toBeNull();
      expect(parseClientAction({ type: 'declareKong', seat: 0, tile }), JSON.stringify(tile) ?? 'undefined').toBeNull();
    }
    expect(parseTile('F1')).toBe('F1');
    expect(parseTile('DW')).toBe('DW');
    expect(parseClientAction({ type: 'exchange', seat: 0, tiles: ['m1', 'x9', 'p2'] })).toBeNull();
    expect(parseClientAction({ type: 'exchange', seat: 0, tiles: 'm1,p2,p3' })).toBeNull();
    expect(parseClientAction({ type: 'exchange', seat: 0, tiles: [] })).toBeNull();
    expect(parseClientAction({ type: 'exchange', seat: 0, tiles: Array(200).fill('m1') })).toBeNull();
    expect(parseClientAction({ type: 'exchange', seat: 0 })).toBeNull();
  });

  it('refuses claims the engine would never offer in that shape', () => {
    const bad = [
      undefined,
      null,
      'win',
      { type: 'mahjong' },
      { type: 'win', tiles: ['m1'] },
      { type: 'chow' },
      { type: 'chow', tiles: ['m1'] },
      { type: 'chow', tiles: ['m1', 'm2', 'm3'] },
      { type: 'pung', tiles: ['m1', 'm1', 'm1'] },
      { type: 'kong', tiles: ['m1', 'm1'] },
      { type: 'pung', tiles: ['m1', 'q1'] },
    ];
    for (const claim of bad) expect(parseClientAction({ type: 'claim', seat: 1, claim }), JSON.stringify(claim) ?? 'undefined').toBeNull();
    // An empty tile list on a win is the same claim as none.
    expect(parseClaim({ type: 'win', tiles: [] })).toEqual({ type: 'win' });
  });

  it('keeps only the fields each move has, dropping everything else', () => {
    expect(parseClientAction({ type: 'pass', seat: 1, claim: { type: 'win' }, tile: 'm1', admin: true })).toStrictEqual({ type: 'pass', seat: 1 });
    expect(parseClientAction({ type: 'discard', seat: 0, tile: 'm5', tiles: ['m1'], version: 9 })).toStrictEqual({ type: 'discard', seat: 0, tile: 'm5' });
    expect(parseClientAction({ type: 'nextHand', seat: 2, seed: 'mine' })).toStrictEqual({ type: 'nextHand' });
    expect(parseClientAction({ type: 'claim', seat: 1, claim: { type: 'pung', tiles: ['p7', 'p7'], from: 3, extra: 1 } })).toStrictEqual({
      type: 'claim',
      seat: 1,
      claim: { type: 'pung', tiles: ['p7', 'p7'] },
    });
    expect(parseClientAction({ type: 'claim', seat: 1, claim: { type: 'win', patternId: 'x' } })).toStrictEqual({ type: 'claim', seat: 1, claim: { type: 'win' } });
    // Keys that JSON.parse makes own properties are dropped like any other.
    expect(parseClientAction(JSON.parse('{"type":"pass","seat":1,"__proto__":{"type":"resolveClaims"}}'))).toStrictEqual({ type: 'pass', seat: 1 });
  });

  /**
   * Whatever the engine offers a player, the validator lets through
   * unchanged: every seat is played by the bot brain through the opening
   * goulash, a South, a West (with its exchanges) and a North hand, and each
   * move goes over the wire and back before it is applied. This seed covers
   * every kind of move but a kong claimed from a discard, which is rare in
   * play and is covered above.
   */
  it('lets through every move the engine offers across whole hands', { timeout: 60_000 }, () => {
    const progresses: GameProgress[] = [
      { roundWind: 'E', roundIndex: 0, handInRound: 0, handIndex: 0 },
      { roundWind: 'S', roundIndex: 1, handInRound: 0, handIndex: 4 },
      { roundWind: 'W', roundIndex: 2, handInRound: 0, handIndex: 8 },
      { roundWind: 'N', roundIndex: 3, handInRound: 0, handIndex: 12 },
    ];
    const seen = new Set<string>();
    const seed = 'wire-1';
    for (const progress of progresses) {
      let s: HandState = startHand(karachi, { seed, progress, dealer: 0 });
      for (let i = 0; i < 800 && s.phase !== 'finished'; i++) {
        const seat = SEATS.find((x) => {
          const legal = legalActions(s, karachi, x);
          return legal.exchange || legal.discard || legal.claims;
        });
        expect(seat, 'nobody to move').not.toBeUndefined();
        const a: Action = analysisBot(viewFor(s, karachi, seat!), karachi) ?? { type: 'pass', seat: seat! };
        const parsed = parseClientAction(wire(a));
        expect(parsed, JSON.stringify(a)).toStrictEqual(a);
        seen.add(a.type === 'claim' ? `claim:${a.claim.type}` : a.type);
        s = reduce(s, parsed as Action, karachi);
      }
      expect(s.phase).toBe('finished');
    }
    for (const t of ['exchange', 'discard', 'declareKong', 'declareWin', 'claim:pung', 'claim:win', 'pass']) expect(seen, t).toContain(t);
  });
});

describe('parseRoomRequest', () => {
  it('creates Karachi rooms, by name or by default', () => {
    expect(parseRoomRequest(undefined)).toEqual({ ok: true, rulesetId: 'karachi', options: {} });
    expect(parseRoomRequest(null)).toEqual({ ok: true, rulesetId: 'karachi', options: {} });
    expect(parseRoomRequest({})).toEqual({ ok: true, rulesetId: 'karachi', options: {} });
    expect(parseRoomRequest({ rulesetId: 'karachi' })).toEqual({ ok: true, rulesetId: 'karachi', options: {} });
  });

  it('refuses every other ruleset, Taiwanese included', () => {
    for (const rulesetId of ['taiwanese', 'hongkong', 'Karachi', '', null, 1, ['karachi'], { id: 'karachi' }]) {
      expect(parseRoomRequest({ rulesetId }).ok, JSON.stringify(rulesetId)).toBe(false);
    }
  });

  it('refuses a body that is not an object', () => {
    for (const body of ['karachi', 3, true, []]) expect(parseRoomRequest(body).ok).toBe(false);
  });

  it('keeps the options the server reads, checked, and drops the rest', () => {
    expect(parseRoomRequest({ rulesetId: 'karachi', options: { strict: true } })).toEqual({ ok: true, rulesetId: 'karachi', options: { strict: true } });
    expect(parseRoomRequest({ options: { strict: false, turnSeconds: 1, handsPerRound: 99, seed: 'fixed' } })).toStrictEqual({
      ok: true,
      rulesetId: 'karachi',
      options: { strict: false },
    });
    expect(parseRoomOptions({ bots: 'none', ruleset: 'taiwanese' })).toStrictEqual({});
    expect(parseRoomOptions(undefined)).toStrictEqual({});
    expect(parseRoomOptions(null)).toStrictEqual({});
  });

  it('refuses a known option with the wrong type, and options that are not an object', () => {
    for (const strict of ['true', 1, 0, null, {}, []]) expect(parseRoomRequest({ options: { strict } }).ok, JSON.stringify(strict)).toBe(false);
    for (const options of ['strict', 1, true, [{ strict: true }]]) expect(parseRoomRequest({ options }).ok, JSON.stringify(options)).toBe(false);
  });
});

describe('cleanDisplayName', () => {
  it('keeps an ordinary name as typed', () => {
    expect(cleanDisplayName('Abrar')).toBe('Abrar');
    expect(cleanDisplayName('  Mary Jane  ')).toBe('Mary Jane');
    expect(cleanDisplayName('Zoë')).toBe('Zoë');
  });

  it(`caps a name at ${MAX_NAME_LENGTH} characters`, () => {
    expect(MAX_NAME_LENGTH).toBe(24);
    expect(cleanDisplayName('x'.repeat(5000))).toBe('x'.repeat(24));
    expect(cleanDisplayName('a'.repeat(23) + ' b')).toBe('a'.repeat(23));
    // Counted by character, so an emoji at the edge is kept whole or not at all.
    const emoji = cleanDisplayName('😀'.repeat(30))!;
    expect(Array.from(emoji)).toHaveLength(24);
    expect(emoji).toBe('😀'.repeat(24));
  });

  it('flattens control characters and runs of space', () => {
    expect(cleanDisplayName('Sana\n\n\tKhan')).toBe('Sana Khan');
    expect(cleanDisplayName('Bi\u0000lal')).toBe('Bi lal');
    expect(cleanDisplayName('A B')).toBe('A B');
  });

  it('gives null when there is no name to use', () => {
    for (const x of [undefined, null, '', '   ', '\n\t', 42, { name: 'x' }, ['x']]) expect(cleanDisplayName(x), JSON.stringify(x) ?? 'undefined').toBeNull();
  });
});

describe('isUuid', () => {
  it('takes an id as the database mints it, in either case', () => {
    expect(isUuid('6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34')).toBe(true);
    expect(isUuid('6F1C2A9E-4B7D-4E3A-9C5F-2D8B0A7E1F34')).toBe(true);
  });

  it('refuses a truncated, padded or hand-edited one, and anything not a string', () => {
    const cut = [
      'not-a-uuid',
      '',
      '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f3',
      '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f345',
      ' 6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34',
      '6f1c2a9e4b7d4e3a9c5f2d8b0a7e1f34',
    ];
    for (const x of [...cut, '6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f3g', "6f1c2a9e-4b7d-4e3a-9c5f-2d8b0a7e1f34' or 1=1", 42, null, undefined]) expect(isUuid(x), String(x)).toBe(false);
  });
});
