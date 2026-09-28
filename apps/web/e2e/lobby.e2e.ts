import { expect, test } from '@playwright/test';
import { SEATS } from '@society/engine';
import { finalStandings } from '../lib/live/final';
import { NOT_HERE_HINT, SHARE, hereCount, seatTag, startLabel, takeSeatCopy, topLine, waitingForHost } from '../lib/live/lifecycle-copy';
import type { RoomSnapshot } from '../lib/live/snapshot';
import { fixtures } from './fixtures';
import { GAME_ID } from './fixtures';
import { flush, openLobby, room } from './live';

/**
 * The lobby between games: who's here and who isn't yet, how the last game
 * went, the link to send, and the host's button, or who everyone's waiting
 * for. The room routes are answered by the test with the lobby as the server
 * would send it.
 */

/** The lobby's "Last game" line, in the page's own words. */
function lastLine(r: RoomSnapshot): string {
  const last = r.lastGame!;
  const row = (seat: number) => last.rows.find((x) => x.seat === seat) ?? null;
  return topLine(
    finalStandings(
      SEATS.map((s) => row(s)),
      SEATS.map((s) => row(s)?.score ?? 0),
    ),
    last.me,
    'then',
  );
}

test.describe('the lobby between games', () => {
  test('(a) the host sees who isn’t here yet, how the last game went, the link to send, and Play again with a bot for them', async ({ page }) => {
    const { lobbyAgain } = fixtures();
    const lobby = await openLobby(page, { join: () => room(lobbyAgain) });

    const rows = page.locator('main .rounded-2xl');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText('Bilal');
    await expect(rows.nth(1)).toContainText(seatTag(lobbyAgain, 1));
    expect(seatTag(lobbyAgain, 1)).toBe('not here yet');
    await expect(rows.nth(0)).toContainText('you');
    // Someone not here yet is drawn faded.
    await expect(rows.nth(1)).toHaveCSS('opacity', '0.6');
    await expect(rows.nth(2)).toHaveCSS('opacity', '1');

    await expect(page.getByText('Last game', { exact: true })).toBeVisible();
    await expect(page.getByText(lastLine(lobbyAgain), { exact: true })).toBeVisible();
    expect(lastLine(lobbyAgain)).toBe('\u2068Bilal\u2069 finished top on +14,504.');

    await expect(page.getByText(SHARE.line)).toBeVisible();
    await expect(page.getByRole('button', { name: SHARE.button })).toBeVisible();
    const start = page.getByRole('button', { name: startLabel(lobbyAgain) });
    await expect(start).toBeVisible();
    // Bilal isn't here yet, so a bot keeps his seat when the game starts, and the host is told so.
    expect(startLabel(lobbyAgain)).toBe('Play again, with one bot');
    await expect(page.getByText(NOT_HERE_HINT, { exact: true })).toBeVisible();
    // Between games Play again is the thing to do, and the link steps back to a quiet one.
    await expect(start).toHaveClass(/btn-primary/);
    await expect(page.getByRole('button', { name: SHARE.button })).not.toHaveClass(/btn-primary/);
    await expect(page.getByText(hereCount(lobbyAgain, 'Karachi rules'), { exact: true })).toBeVisible();
    expect(lobby.pageErrors).toEqual([]);
  });

  test('(a) everyone else is told who they’re waiting for, by name, and sees no start button', async ({ page }) => {
    const { lobbyGuest } = fixtures();
    const lobby = await openLobby(page, { join: () => room(lobbyGuest) });
    await expect(page.getByText(waitingForHost(lobbyGuest), { exact: true })).toBeVisible();
    expect(waitingForHost(lobbyGuest)).toBe("That game's over. Waiting for \u2068Hana\u2069 to start the next one.");
    await expect(page.getByRole('button', { name: /Play again|Start/ })).toHaveCount(0);
    // The hint is for whoever starts the game.
    await expect(page.getByText(NOT_HERE_HINT)).toHaveCount(0);
    await expect(page.locator('main .rounded-2xl').nth(2)).toContainText('host');
    expect(lobby.pageErrors).toEqual([]);
  });

  test('(a) before the first game, with a seat still empty, sending the link comes first and Start steps back', async ({ page }) => {
    const { lobbyAgain } = fixtures();
    const fresh: RoomSnapshot = { ...lobbyAgain, status: 'lobby', gameId: null, lastGame: null, seats: [lobbyAgain.seats[0]!, null, null, null] };
    const lobby = await openLobby(page, { join: () => room(fresh) });
    await expect(page.getByRole('button', { name: SHARE.button })).toHaveClass(/btn-primary/);
    const start = page.getByRole('button', { name: startLabel(fresh) });
    expect(startLabel(fresh)).toBe('Start, with three bots');
    await expect(start).toHaveClass(/btn-ghost/);
    await expect(page.getByText('Last game', { exact: true })).toHaveCount(0);
    await expect(page.getByText(NOT_HERE_HINT)).toHaveCount(0);
    expect(lobby.pageErrors).toEqual([]);
  });
});

test.describe('the lobby at a game in play', () => {
  test('(b) someone not seated is offered a bot’s seat; one tap takes it and goes to the table, and the lobby never polls', async ({ page }) => {
    const { lobbyOffer, lobbySeated } = fixtures();
    const lobby = await openLobby(page, { join: () => room(lobbyOffer), sit: () => room(lobbySeated) });
    const copy = takeSeatCopy(lobbyOffer.offer!);
    await expect(page.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(page.getByText(copy.body)).toBeVisible();
    // Five seconds is the lobby's poll: someone looking at a seat to take has nothing to poll for.
    await page.waitForTimeout(5500);
    await flush(page);
    expect(lobby.count('room')).toBe(0);
    await page.getByRole('button', { name: copy.confirmLabel }).click();
    await expect(page).toHaveURL(new RegExp(`/g/${GAME_ID}$`));
    expect(lobby.count('sit')).toBe(1);
    expect(lobby.of('sit')[0]!.sent).toEqual({ seat: 2, name: 'Amna' });
    expect(lobby.pageErrors).toEqual([]);
  });

  test('(b) a seat that went to someone else says so, and the lobby asks again for a fresh offer', async ({ page }) => {
    const { lobbyOffer } = fixtures();
    const lobby = await openLobby(page, { join: () => room(lobbyOffer), sit: () => ({ status: 409, body: { error: 'that seat is kept for someone' } }) });
    const copy = takeSeatCopy(lobbyOffer.offer!);
    await page.getByRole('button', { name: copy.confirmLabel }).click();
    await expect(page.locator('main').getByRole('alert')).toHaveText("That seat isn't free. Open the invite link again to see where you can sit.");
    await expect.poll(() => lobby.count('join')).toBe(2);
    await expect(page.getByRole('button', { name: copy.confirmLabel })).toBeEnabled();
    expect(lobby.pageErrors).toEqual([]);
  });
});
