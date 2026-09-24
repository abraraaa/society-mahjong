import { afterEach, describe, expect, it, vi } from 'vitest';

/** A page with no hCaptcha on it yet: records the scripts added, and lets the test say how each load went. */
function page() {
  const scripts: Array<{ src?: string; onerror?: () => void }> = [];
  const win: { hcaptcha?: unknown; __hcaptchaReady?: () => void } = {};
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { createElement: () => ({}), head: { appendChild: (s: { src?: string; onerror?: () => void }) => scripts.push(s) } });
  return { scripts, win };
}

const API = { render: () => 'w', execute: async () => ({ response: 't' }), remove: () => {}, reset: () => {} };

describe('loadHcaptcha', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('starts afresh on the next Sit down when the script loaded but hCaptcha never came up', async () => {
    const { scripts, win } = page();
    const { loadHcaptcha } = await import('./captcha');
    const first = loadHcaptcha();
    win.__hcaptchaReady!();
    await expect(first).rejects.toThrow('hcaptcha did not initialise');

    const second = loadHcaptcha();
    expect(scripts).toHaveLength(2);
    win.hcaptcha = API;
    win.__hcaptchaReady!();
    await expect(second).resolves.toBe(API);
  });

  it('starts afresh on the next Sit down when the script failed to load', async () => {
    const { scripts, win } = page();
    const { loadHcaptcha } = await import('./captcha');
    const first = loadHcaptcha();
    scripts[0]!.onerror!();
    await expect(first).rejects.toThrow('could not load hCaptcha');

    const second = loadHcaptcha();
    expect(scripts).toHaveLength(2);
    win.hcaptcha = API;
    win.__hcaptchaReady!();
    await expect(second).resolves.toBe(API);
  });

  it('loads the script once while it is on its way', async () => {
    const { scripts } = page();
    const { loadHcaptcha } = await import('./captcha');
    void loadHcaptcha();
    void loadHcaptcha();
    expect(scripts).toHaveLength(1);
  });
});
