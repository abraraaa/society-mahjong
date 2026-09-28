import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { karachi, startHand, viewFor } from '@society/engine';
import { NAMES, ROUNDS, stickyCoach } from './test-games';
import { useCoach, type CoachSource } from './use-coach';
import { textOf } from './words';

/** The hook's answer, as the server renders it: its first render stores the plan it sees, and React renders again at once. */
function rendered(source: CoachSource | null): string {
  function Probe() {
    const coach = useCoach(source);
    return createElement('p', null, coach ? `${coach.target?.patternId ?? ''}|${textOf(coach.say)}` : 'none');
  }
  // React escapes the text; the tutor's words only need their apostrophes and ampersands back.
  return renderToString(createElement(Probe))
    .replace(/^<p>|<\/p>$/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('useCoach', () => {
  it('plans with the hand it has just marked, settling in the same render, as the tutor held to a plan does', () => {
    for (const [round, progress] of Object.entries(ROUNDS)) {
      const view = viewFor(startHand(karachi, { seed: `hook-${round}`, progress, dealer: 0 }), karachi, 0);
      const expected = stickyCoach(1)(view, 'new');
      expect(rendered({ view, ruleset: karachi, stage: 'new', names: NAMES, game: 1 }), round).toBe(`${expected.target?.patternId ?? ''}|${textOf(expected.say)}`);
    }
  });

  it('gives nothing for a table still waiting for its first view', () => {
    expect(rendered(null)).toBe('none');
  });
});
