# Society Mahjong

Social mahjong for phones and tablets: the rules your table plays, friends anywhere, bots to fill seats, and a tutor for first-timers. Karachi rules ship first because that is where the current craze is; the product is not tied to one style.

- `docs/PLAN.md` — product, architecture, milestones
- `docs/RULES-KARACHI.md`, `docs/RULES-TAIWANESE.md` — rules specs the engine is built from
- `packages/engine` — pure TypeScript rules engine: tiles, pattern language, rulesets, game reducer, bots
- `apps/web` — Next.js app (Vercel) with Supabase for auth, data and realtime
- `supabase/migrations` — database schema

```sh
pnpm install
pnpm test          # engine tests
pnpm dev           # web app on http://localhost:3000
```

pnpm itself is pinned by `packageManager` in `package.json`: any pnpm from 10 on fetches that version and hands over
to it. Its settings live in `pnpm-workspace.yaml`, the only place pnpm 11 and later read them from; an `.npmrc` would
be for registry and auth alone.

## Licence

Proprietary, all rights reserved. Public on GitHub for development convenience only; see `LICENSE`.
