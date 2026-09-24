import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Browser tests for what unit tests can't reach: the live table's timing
 * against a Realtime socket and the game routes, the name gate before
 * hydration, the solo table across a hand boundary, and the pages a stray
 * link lands on.
 *
 * They run against a production build made with the fake Supabase's address
 * baked in (the NEXT_PUBLIC_ settings are inlined at build time):
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3499 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key pnpm build
 *   pnpm test:e2e
 *
 * Set PW_CHROMIUM_PATH to use a Chromium already on the machine instead of
 * Playwright's own (which `pnpm exec playwright install chromium` fetches).
 */

const WEB = path.resolve(__dirname, '..');
const PORT = Number(process.env.E2E_PORT ?? 3490);
const SUPABASE_URL = 'http://127.0.0.1:3499';
const SUPABASE_ENV = { NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key' };

export default defineConfig({
  testDir: '.',
  // Not *.spec.ts or *.test.ts, so vitest's default include never picks these up.
  testMatch: '**/*.e2e.ts',
  outputDir: 'test-results',
  globalSetup: './global-setup.ts',
  // One page at a time: the scenarios are about timing, and a busy CI box shouldn't have to share.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // A phone held upright: the table's portrait layout.
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      name: 'supabase',
      command: 'node e2e/fake-supabase.mjs',
      cwd: WEB,
      url: `${SUPABASE_URL}/auth/v1/user`,
      reuseExistingServer: false,
    },
    {
      name: 'next',
      command: `node node_modules/next/dist/bin/next start -p ${PORT} -H 127.0.0.1`,
      cwd: WEB,
      url: `http://127.0.0.1:${PORT}/robots.txt`,
      env: SUPABASE_ENV,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
  ],
});
