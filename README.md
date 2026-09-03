# Society Mahjong

Social mahjong for phones and tablets. Karachi rules first, Taiwanese and Hong Kong to follow, with a tutor for first-timers.

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
