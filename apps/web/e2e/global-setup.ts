import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The tests talk to a fake Supabase at 127.0.0.1:3499, and the browser only
 * does so if the build was made with that address. A build made for anywhere
 * else would fail every live test in ways that point nowhere near the cause.
 */
export default function globalSetup(): void {
  const chunks = path.resolve(__dirname, '..', '.next', 'static', 'chunks');
  let baked = false;
  try {
    baked = readdirSync(chunks, { recursive: true, encoding: 'utf8' }).some(
      (f) => f.endsWith('.js') && readFileSync(path.join(chunks, f), 'utf8').includes('http://127.0.0.1:3499'),
    );
  } catch {
    // no build at all: said below
  }
  if (!baked) {
    throw new Error(
      'The e2e tests need a build made against the fake Supabase. From apps/web run:\n' +
        '  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3499 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key pnpm build',
    );
  }
}
