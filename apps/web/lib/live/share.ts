/**
 * Sending the table's link: the phone's share sheet where it has one, the
 * clipboard where it doesn't. Client-safe and free of the DOM's globals, so
 * the page hands in `navigator` and the tests hand in a stand-in.
 *
 * Both are gated on the tap that asked for them (user activation), and
 * `share()` uses that tap up before it can fail, so nothing else can be
 * tried on the same tap. iOS 27.0 and 27.1 could also drop a tap's
 * activation, so the first share failed with `NotAllowedError` and the second
 * worked (fixed in Safari 27.2). Either way the button asks for another tap
 * rather than look as though nothing happened. Every iPhone that can open the
 * app has a share sheet (iOS 12.2) or the clipboard (13.4); one with neither
 * is pointed at the code, which is on the screen.
 */

/**
 * How it went: `shared` and `cancelled` say nothing more; the others change what the button says. `copyNext` is a
 * share sheet that failed after taking the tap: the next tap should skip it and copy the link (`skipShare`).
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'again' | 'copyNext' | 'failed';

/** The parts of `navigator` this uses. */
export interface ShareNavigator {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
  readonly clipboard?: { readonly writeText?: (text: string) => Promise<void> };
}

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null && typeof (err as { name?: unknown }).name === 'string' ? (err as { name: string }).name : '';
}

export async function shareLink(
  nav: ShareNavigator,
  data: { readonly title: string; readonly text: string; readonly url: string },
  { skipShare = false }: { readonly skipShare?: boolean } = {},
): Promise<ShareOutcome> {
  if (!skipShare && nav.share && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (err) {
      const name = errorName(err);
      // Dismissed, or a second tap while the sheet from the first is still up.
      if (name === 'AbortError' || name === 'InvalidStateError') return 'cancelled';
      // The tap didn't count (iOS 27.0 and 27.1): the sheet will open on the next one.
      if (name === 'NotAllowedError') return 'again';
      // Anything else (a link the sheet won't take) failed after using the tap up, so the clipboard would be refused
      // now: the next tap goes straight to it, and the sheet isn't tried again.
      return nav.clipboard?.writeText ? 'copyNext' : 'failed';
    }
  }
  if (nav.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(data.url);
      return 'copied';
    } catch (err) {
      return errorName(err) === 'NotAllowedError' ? 'again' : 'failed';
    }
  }
  return 'failed';
}
