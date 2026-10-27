import { describe, expect, it, vi } from 'vitest';
import { shareLink, type ShareNavigator } from './share';

const DATA = { title: 'Mahjong?', text: 'Join my table: KHI-4287Q', url: 'https://societymahjong.app/r/KHI-4287Q' };

/** A rejection the way the browser makes one: a DOMException, known by its name. */
const refused = (name: string) => Promise.reject(new DOMException('no', name));

describe('shareLink', () => {
  it('shares through the share sheet, and copies nothing', async () => {
    const writeText = vi.fn(async () => {});
    const nav: ShareNavigator = { share: vi.fn(async () => {}), clipboard: { writeText } };
    expect(await shareLink(nav, DATA)).toBe('shared');
    expect(nav.share).toHaveBeenCalledWith(DATA);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says nothing when the sheet is dismissed, or tapped again while it is up', async () => {
    for (const name of ['AbortError', 'InvalidStateError']) {
      const writeText = vi.fn(async () => {});
      expect(await shareLink({ share: () => refused(name), clipboard: { writeText } }, DATA)).toBe('cancelled');
      expect(writeText).not.toHaveBeenCalled();
    }
  });

  it('asks for the tap again when the browser dropped it (iOS 27.0 and 27.1), without trying the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareLink({ share: () => refused('NotAllowedError'), clipboard: { writeText } }, DATA)).toBe('again');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('asks for another tap when the sheet fails after using this one up, and that tap copies without trying the sheet', async () => {
    const writeText = vi.fn(async () => {});
    const share = vi.fn(() => refused('DataError'));
    const nav: ShareNavigator = { share, clipboard: { writeText } };
    // The sheet took the tap (Web Share consumes user activation) before failing, so the clipboard isn't tried on it.
    expect(await shareLink(nav, DATA)).toBe('copyNext');
    expect(writeText).not.toHaveBeenCalled();
    expect(await shareLink(nav, DATA, { skipShare: true })).toBe('copied');
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it('gives up when the sheet fails that way on a phone with no clipboard to fall back on', async () => {
    expect(await shareLink({ share: () => refused('TypeError') }, DATA)).toBe('failed');
  });

  it('copies straight away when the sheet says up front it will not take the link, which leaves the tap unused', async () => {
    const writeText = vi.fn(async () => {});
    const share = vi.fn(async () => {});
    expect(await shareLink({ share, canShare: () => false, clipboard: { writeText } }, DATA)).toBe('copied');
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it('copies the link on a phone with no share sheet', async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareLink({ clipboard: { writeText } }, DATA)).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(DATA.url);
  });

  it('asks for the tap again when the clipboard refuses it for want of one, and gives up on anything else', async () => {
    expect(await shareLink({ clipboard: { writeText: () => refused('NotAllowedError') } }, DATA)).toBe('again');
    expect(await shareLink({ clipboard: { writeText: () => Promise.reject(new Error('gone')) } }, DATA)).toBe('failed');
  });

  it('gives up on a phone with neither', async () => {
    expect(await shareLink({}, DATA)).toBe('failed');
    expect(await shareLink({ clipboard: {} }, DATA)).toBe('failed');
  });
});
