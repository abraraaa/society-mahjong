import { logError, type LogContext } from './log';

/** One write that follows a saved move. `what` names it in the log, in the store's own words ("log the move"). */
export interface CommitStep {
  readonly what: string;
  readonly run: () => Promise<unknown>;
}

/**
 * Everything after the commit point, which is the moment the live state is
 * saved. From then on the move counts, so nothing here may take it back:
 *
 * - each step runs in turn, and one that throws is logged and the next
 *   still runs (a failed hand log must not stop the game being finished);
 * - the poke goes out last, whatever the steps did, so the others refetch a
 *   table whose scores and status are already written;
 * - nothing throws, so the caller answers with the table as it now stands.
 *
 * Returns the `what` of each step that failed. `log` is there for tests.
 */
export async function afterCommit(steps: readonly CommitStep[], poke: () => Promise<void>, context: LogContext, log: typeof logError = logError): Promise<string[]> {
  const note: typeof logError = (event, err, ctx) => {
    try {
      log(event, err, ctx);
    } catch {
      // A log that cannot be written must not cost the move either.
    }
  };
  const failed: string[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (err) {
      failed.push(step.what);
      note('after_commit_failed', err, { ...context, step: step.what });
    }
  }
  try {
    await poke();
  } catch (err) {
    note('poke_failed', err, context);
  }
  return failed;
}
