import { describe, expect, it, vi } from 'vitest';
import { afterCommit, type CommitStep } from './commit';
import { SupabaseError } from './errors';

/**
 * The post-commit sequence on its own, with the steps, the poke and the log
 * all injected: a move that has been saved is never undone by what follows.
 */
function recorder() {
  const order: string[] = [];
  const step = (what: string, fail?: Error): CommitStep => ({
    what,
    run: async () => {
      order.push(what);
      if (fail) throw fail;
    },
  });
  const poke = vi.fn(async () => {
    order.push('poke');
  });
  const log = vi.fn();
  return { order, step, poke, log };
}

describe('afterCommit', () => {
  it('runs every step in order, then pokes, and reports nothing failed', async () => {
    const { order, step, poke, log } = recorder();
    const failed = await afterCommit([step('log the move'), step('close the hand'), step('finish the game')], poke, { gameId: 'g-1', version: 4 }, log);
    expect(failed).toEqual([]);
    expect(order).toEqual(['log the move', 'close the hand', 'finish the game', 'poke']);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs a step that throws, still runs the rest, and still pokes last', async () => {
    const { order, step, poke, log } = recorder();
    const down = new SupabaseError('log the move', { message: 'TypeError: fetch failed' });
    const failed = await afterCommit([step('log the move', down), step('close the hand'), step('finish the game')], poke, { gameId: 'g-1', version: 4 }, log);
    expect(failed).toEqual(['log the move']);
    expect(order).toEqual(['log the move', 'close the hand', 'finish the game', 'poke']);
    expect(poke).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('after_commit_failed', down, { gameId: 'g-1', version: 4, step: 'log the move' });
  });

  it('pokes even when every step fails', async () => {
    const { order, step, poke, log } = recorder();
    const failed = await afterCommit([step('close the hand', new Error('a')), step('finish the game', new Error('b'))], poke, { gameId: 'g-1' }, log);
    expect(failed).toEqual(['close the hand', 'finish the game']);
    expect(order.at(-1)).toBe('poke');
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('logs a poke that throws instead of throwing it', async () => {
    const { step, log } = recorder();
    const refused = new Error('Realtime is down');
    const poke = vi.fn(async () => {
      throw refused;
    });
    await expect(afterCommit([step('log the move')], poke, { gameId: 'g-1' }, log)).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith('poke_failed', refused, { gameId: 'g-1' });
  });

  it('does not throw even when the log itself does', async () => {
    const { step, poke } = recorder();
    const log = vi.fn(() => {
      throw new Error('stderr is closed');
    });
    await expect(afterCommit([step('log the move', new Error('down'))], poke, {}, log)).resolves.toEqual(['log the move']);
    expect(poke).toHaveBeenCalledTimes(1);
  });

  it('with nothing to write, still pokes once', async () => {
    const { poke, log } = recorder();
    await afterCommit([], poke, {}, log);
    expect(poke).toHaveBeenCalledTimes(1);
  });

  it('logs through console.error as one JSON line when no log is given', async () => {
    const { step, poke } = recorder();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await afterCommit([step('open the hand', new SupabaseError('open the hand', { message: 'timeout', code: '57014' }))], poke, { gameId: 'g-1', version: 9 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(spy.mock.calls[0]![0] as string)).toMatchObject({
        level: 'error',
        event: 'after_commit_failed',
        gameId: 'g-1',
        version: 9,
        step: 'open the hand',
        name: 'SupabaseError',
        code: '57014',
      });
    } finally {
      spy.mockRestore();
    }
  });
});
