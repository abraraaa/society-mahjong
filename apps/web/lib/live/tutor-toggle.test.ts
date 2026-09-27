import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The tutor toggle is module state plus storage, so each test loads a fresh copy against its own storage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  };
}

async function load() {
  return import('./tutor-toggle');
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('the tutor toggle', () => {
  it('is on by default', async () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect((await load()).readTutorOn()).toBe(true);
  });

  it('remembers off across a reload', async () => {
    const storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    (await load()).saveTutorOn(false);
    expect(storage.data.get('sm:tutor')).toBe('off');
    vi.resetModules();
    expect((await load()).readTutorOn()).toBe(false);
  });

  it('reads anything but "off" as on', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ 'sm:tutor': 'banana' }));
    expect((await load()).readTutorOn()).toBe(true);
  });

  it('still works for the visit when storage refuses both reads and writes', async () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    vi.stubGlobal('localStorage', broken);
    const t = await load();
    expect(t.readTutorOn()).toBe(true);
    t.saveTutorOn(false);
    expect(t.readTutorOn()).toBe(false);
  });
});
