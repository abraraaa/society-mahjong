import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentName, useGuestName } from './use-guest-name';

function Probe() {
  const { name, initialName } = useGuestName();
  return createElement('p', null, `name=${String(name)} initial=${JSON.stringify(initialName)}`);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGuestName', () => {
  it('renders as a stranger on the server, whatever is stored, so hydration matches', () => {
    // A window and a stored name, as in the browser: the old `typeof window` guard would have read it here,
    // and the first render in the browser (hydration) would then disagree with the server's.
    const getItem = vi.fn(() => 'Abrar');
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', { getItem, setItem: vi.fn() });
    expect(renderToString(createElement(Probe))).toBe('<p>name=null initial=&quot;&quot;</p>');
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe('currentName', () => {
  it('uses the remembered name until the gate is answered', () => {
    expect(currentName('Abrar', null)).toBe('Abrar');
    expect(currentName(null, null)).toBeNull();
  });

  it("uses the gate's answer, even when storage refused to keep it", () => {
    expect(currentName(null, { name: 'Sana' })).toBe('Sana');
    expect(currentName('Abrar', { name: 'Sana' })).toBe('Sana');
  });

  it('shows the gate again when asked to, even with a name remembered', () => {
    expect(currentName('Abrar', { name: null })).toBeNull();
  });
});
