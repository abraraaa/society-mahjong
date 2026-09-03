import { FULL_SET } from '../../tiles';
import type { GameProgress, HandSpec, Ruleset, WinInput } from '../../ruleset';
import { TW_PATTERNS_HOUSE, TW_PATTERNS_STANDARD } from './patterns';
import { scoreTaiwanese, type TaiwaneseSheet } from './scoring';

export interface TaiwaneseOptions {
  readonly sheet: TaiwaneseSheet;
}

export function createTaiwanese(opts: TaiwaneseOptions = { sheet: 'house' }): Ruleset {
  const patterns = opts.sheet === 'standard' ? TW_PATTERNS_STANDARD : TW_PATTERNS_HOUSE;
  const spec: HandSpec = { kind: 'standard', label: 'Taiwanese 16-tile', patterns };
  return {
    id: 'taiwanese',
    name: `Taiwanese (${opts.sheet})`,
    description: '16-tile Taiwanese mahjong as played in Dubai. Five sets and a pair.',
    tiles: FULL_SET,
    shape: { handSize: 16, sets: 5 },
    deadWallSize: 16,
    claims: {
      chowFromDiscard: 'left',
      pungFromDiscard: true,
      kongFromDiscard: true,
      winFromDiscard: true,
      multipleWinners: opts.sheet !== 'standard',
      passingRule: true,
    },
    dealerRetainsOnWin: true,
    roundsPerGame: 4,
    handsPerRound: 4,
    handSpec: (_p: GameProgress) => spec,
    guards: {},
    score: (win: WinInput) => scoreTaiwanese(win, opts.sheet),
  };
}

export const taiwanese: Ruleset = createTaiwanese();
export * from './patterns';
export * from './scoring';
