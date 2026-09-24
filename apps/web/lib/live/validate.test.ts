import { describe, expect, it } from 'vitest';
import { SEATS, analysisBot, karachi, legalActions, reduce, startHand, viewFor, type Action, type GameProgress, type HandState } from '@society/engine';
import { NAME_MAX } from '../name-gate';
import { CLIENT_ACTION_TYPES, PLAYER_ACTION_TYPES } from './types';
import { cleanDisplayName, isUuid, parseClaim, parseClientAction, parseRoomOptions, parseRoomRequest, parseSeat, parseTile } from './validate';

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
  const family = '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}';
  const astronaut = '\u{1f469}\u{1f3fd}\u{200d}\u{1f680}';
  const scotland = '\u{1f3f4}\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}';

  it('keeps an ordinary name as typed', () => {
    expect(cleanDisplayName('Abrar')).toBe('Abrar');
    expect(cleanDisplayName('  Mary Jane  ')).toBe('Mary Jane');
    expect(cleanDisplayName('Zoë')).toBe('Zoë');
    expect(cleanDisplayName('\u{639}\u{627}\u{626}\u{634}\u{6c1}')).toBe('\u{639}\u{627}\u{626}\u{634}\u{6c1}');
    expect(cleanDisplayName('J.')).toBe('J.');
    expect(cleanDisplayName('7')).toBe('7');
    expect(cleanDisplayName('\u{1f004}')).toBe('\u{1f004}');
  });

  it(`caps a name at ${NAME_MAX} characters, the name gate's limit`, () => {
    expect(cleanDisplayName('x'.repeat(5000))).toBe('x'.repeat(NAME_MAX));
    expect(cleanDisplayName('a'.repeat(NAME_MAX - 1) + ' b')).toBe('a'.repeat(NAME_MAX - 1));
    expect(cleanDisplayName('😀'.repeat(30))).toBe('😀'.repeat(NAME_MAX));
  });

  it('counts characters as a reader does, so an emoji made of several code points is kept whole', () => {
    expect(cleanDisplayName(family.repeat(6))).toBe(family.repeat(6));
    expect(cleanDisplayName(`Sana ${astronaut}`)).toBe(`Sana ${astronaut}`);
    expect(cleanDisplayName(`Iain ${scotland}`)).toBe(`Iain ${scotland}`);
    expect(cleanDisplayName('\u{1f1f5}\u{1f1f0}'.repeat(30))).toBe('\u{1f1f5}\u{1f1f0}'.repeat(NAME_MAX));
    // An accent typed as its own code point counts with its letter.
    expect(cleanDisplayName('e\u{301}'.repeat(30))).toBe('e\u{301}'.repeat(NAME_MAX));
  });

  it('stops at a whole character once the code points run long', () => {
    // A seventh family would pass 48 code points.
    expect(cleanDisplayName(family.repeat(10))).toBe(family.repeat(6));
    // A letter under a pile of accents is one character, but not an endless one.
    expect(cleanDisplayName(`Abrar${'\u{301}'.repeat(100)}`)).toBe('Abra');
    expect(cleanDisplayName(`A${'\u{301}'.repeat(100)}`)).toBeNull();
  });

  it('without Intl.Segmenter, counts code points and never ends on a joiner', () => {
    const { Segmenter } = Intl;
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true });
    try {
      expect(cleanDisplayName('x'.repeat(40))).toBe('x'.repeat(NAME_MAX));
      // 'a', three families (21 code points), then a man and the joiner after him make 24: the joiner goes.
      expect(cleanDisplayName(`a${family.repeat(4)}`)).toBe(`a${family.repeat(3)}\u{1f468}`);
      expect(cleanDisplayName('\u{202e}Abrar')).toBe('Abrar');
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { value: Segmenter, configurable: true, writable: true });
    }
    expect(typeof Intl.Segmenter).toBe('function');
  });

  it('flattens control characters and runs of space', () => {
    expect(cleanDisplayName('Sana\n\n\tKhan')).toBe('Sana Khan');
    expect(cleanDisplayName('Bi\u0000lal')).toBe('Bi lal');
    expect(cleanDisplayName('Bi\u{85}lal')).toBe('Bi lal');
    expect(cleanDisplayName('A\u{2028}B')).toBe('A B');
  });

  it('takes out bidi controls, which would turn the rest of a line round for everyone at the table', () => {
    expect(cleanDisplayName('\u{202e}Abrar')).toBe('Abrar');
    expect(cleanDisplayName('Ab\u{2066}rar')).toBe('Abrar');
    for (const c of ['\u{61c}', '\u{200e}', '\u{200f}', '\u{202a}', '\u{202b}', '\u{202c}', '\u{202d}', '\u{2067}', '\u{2068}', '\u{2069}']) {
      expect(cleanDisplayName(`Sa${c}na`), c.codePointAt(0)!.toString(16)).toBe('Sana');
    }
  });

  it('takes out characters that print nothing, and refuses a name made only of them', () => {
    for (const c of ['\u{200b}', '\u{ad}', '\u{3164}', '\u{115f}', '\u{1160}', '\u{ffa0}', '\u{2800}', '\u{feff}', '\u{2060}', '\u{180e}']) {
      expect(cleanDisplayName(c), c.codePointAt(0)!.toString(16)).toBeNull();
      expect(cleanDisplayName(`Bi${c}lal`), c.codePointAt(0)!.toString(16)).toBe('Bilal');
    }
    expect(cleanDisplayName('\u{200b}\u{3164} \u{2800}\u{202e}')).toBeNull();
  });

  it('keeps the joiners that emoji and Urdu or Persian spelling are made with, but not one left joining nothing', () => {
    const alireza = '\u{639}\u{644}\u{6cc}\u{200c}\u{631}\u{636}\u{627}';
    expect(cleanDisplayName(alireza)).toBe(alireza);
    expect(cleanDisplayName(`Abrar\u{200d}`)).toBe('Abrar');
    expect(cleanDisplayName('\u{200d}')).toBeNull();
    expect(cleanDisplayName('\u{200c}')).toBeNull();
  });

  it('refuses a name with no letter, number or symbol in it', () => {
    for (const x of ['...', '- -', '!?', '()', '\u{301}', '\u{e0067}\u{e007f}']) expect(cleanDisplayName(x), x).toBeNull();
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
