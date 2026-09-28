import { describe, expect, it, vi } from 'vitest';
import { karachi, type PrivatePlayerView } from '@society/engine';
import { preferFor, type PlanMark } from './plan-mark';
import { NAMES, ROUNDS, coachOf, playHand, stickyCoach } from './test-games';
import type { CoachInput } from './coach';
import type { CoachState } from './types';
import { useCoach } from './use-coach';
import { textOf } from './words';

/**
 * useCoach over one hand, view after view, with its state carried from each
 * view to the next as a mounted table carries it. There's no DOM here, so
 * React's own `useState` and `useMemo` are swapped for a stand-in that keeps
 * one slot per hook call, recomputes a memo only when a dependency changes
 * (Object.is), and, as React does, renders again at once when state is set
 * during render. A wrong dependency, or the wrong mark handed to the tutor,
 * shows up as a line that differs from the tutor held to a plan, or as words
 * worked out from an analysis that kept some other plan in front than the one
 * the tutor was told it holds.
 */

const hooks = vi.hoisted(() => {
  let slots: unknown[] = [];
  let at = 0;
  let setDuringRender = false;
  return {
    useState<T>(initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
      const k = at++;
      if (!(k in slots)) slots[k] = typeof initial === 'function' ? (initial as () => T)() : initial;
      const set = (v: T | ((prev: T) => T)) => {
        const next = typeof v === 'function' ? (v as (prev: T) => T)(slots[k] as T) : v;
        if (!Object.is(next, slots[k])) {
          slots[k] = next;
          setDuringRender = true;
        }
      };
      return [slots[k] as T, set];
    },
    useMemo<T>(compute: () => T, deps: readonly unknown[]): T {
      const k = at++;
      const prev = slots[k] as { deps: readonly unknown[]; value: T } | undefined;
      if (prev && prev.deps.length === deps.length && prev.deps.every((d, i) => Object.is(d, deps[i]))) return prev.value;
      const value = compute();
      slots[k] = { deps, value };
      return value;
    },
    /** one render of a mounted component: again and again until no state was set during it, as React does */
    render<T>(component: () => T): T {
      for (let pass = 0; pass < 25; pass++) {
        at = 0;
        setDuringRender = false;
        const out = component();
        if (!setDuringRender) return out;
      }
      throw new Error('too many renders');
    },
    unmount() {
      slots = [];
    },
  };
});

/** The plan each analysis was asked to keep in front, and what each of the tutor's answers was worked out from. */
const made = vi.hoisted(() => ({ prefer: new WeakMap<object, string | undefined>(), from: new WeakMap<object, { readonly analysis: object; readonly mark: PlanMark | null }>() }));

vi.mock('./coach', async (importOriginal) => {
  const real = await importOriginal<typeof import('./coach')>();
  return {
    ...real,
    analyseFor: (...args: Parameters<typeof real.analyseFor>) => {
      const analysis = real.analyseFor(...args);
      made.prefer.set(analysis, args[2]);
      return analysis;
    },
    coachFor: (input: CoachInput) => {
      const coach = real.coachFor(input);
      made.from.set(coach, { analysis: input.analysis, mark: input.mark ?? null });
      return coach;
    },
  };
});

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), useState: hooks.useState, useMemo: hooks.useMemo }));

const said = (coach: CoachState | null) =>
  coach ? `${coach.target?.patternId ?? ''}|${textOf(coach.say)}|${coach.planSwitch ? `${coach.planSwitch.from.title}/${coach.planSwitch.closerBy}` : ''}` : 'none';

describe('useCoach, view after view', () => {
  // A South hand that switches between Any Damn Hand and Crazy Chows three times in its first fifteen views, and a
  // North hand where the plan the player is on settles a tie between two named hands, then switches twice.
  const hands = [
    { game: 'S-2', seed: 'switch-S-2', progress: ROUNDS.S, dealer: 2 as const, switches: 3 },
    { game: 'N-1', seed: 'switch-N-1', progress: ROUNDS.N, dealer: 1 as const, switches: 2 },
  ];

  it('holds the plan and tells each switch on the turn, exactly as the tutor held to a plan does', { timeout: 120_000 }, () => {
    for (const { game, seed, progress, dealer, switches } of hands) {
      const views: PrivatePlayerView[] = [];
      playHand({ seed, progress, dealer, onView: (view) => views.push(view) });
      const held = stickyCoach(game);
      hooks.unmount();
      const told: string[] = [];
      let steadied = 0;
      for (const view of views) {
        const coach = hooks.render(() => useCoach({ view, ruleset: karachi, stage: 'learning', names: NAMES, game }));
        expect(said(coach), `${game} seq ${view.seq}`).toBe(said(held(view, 'learning')));
        // The words come from an analysis that kept the very plan they're held to in front: after a switch, the
        // analysis is made again with the new plan, not kept from the render that found it.
        const from = made.from.get(coach!)!;
        expect(made.prefer.get(from.analysis), `${game} seq ${view.seq}`).toBe(preferFor(from.mark, game, view));
        if (coach?.planSwitch) told.push(textOf(coach.say));
        if (coach?.target?.patternId !== coachOf(view).target?.patternId) steadied++;
      }
      expect(told, game).toHaveLength(switches);
      for (const line of told) expect(line, game).toMatch(/^Discard [^.]+\. Switching to /);
      // In North the held plan really does lead where the tutor with no plan would have named the other hand.
      if (game === 'N-1') expect(steadied).toBeGreaterThan(0);
    }
  });
});
