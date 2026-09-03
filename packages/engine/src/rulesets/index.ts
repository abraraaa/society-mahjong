import type { Ruleset, RulesetId } from '../ruleset';
import { karachi } from './karachi/index';
import { taiwanese } from './taiwanese/index';

export const RULESETS: Readonly<Record<Exclude<RulesetId, 'hongkong'>, Ruleset>> = { karachi, taiwanese };

export function getRuleset(id: RulesetId): Ruleset {
  const r = (RULESETS as Partial<Record<RulesetId, Ruleset>>)[id];
  if (!r) throw new Error(`ruleset ${id} not implemented yet`);
  return r;
}

export * from './karachi/index';
export * from './taiwanese/index';
