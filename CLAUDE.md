# Society Mahjong

## Dependencies: stay current

The policy is to run the newest stable release of everything, so the app can use what's new in each: the framework,
React, Supabase, the toolchain, the CI actions, Node and pnpm. Being behind is a defect to fix, not a state to
keep.

- **Stable releases only.** No canary, beta, rc or next tags in what ships.
- **Three days old at least.** `minimumReleaseAge` in pnpm-workspace.yaml keeps anything published in the last three
  days out of the install, so a hijacked release is usually caught and pulled before it reaches us. Don't lower it
  to get a release sooner.
- **When you touch a package, bring it up to date.** Before a batch of work, run `pnpm -r outdated` and take what's
  behind.
- **Majors go one at a time,** each with the full check list (typecheck, lint, unit tests, database checks, build,
  e2e), and whatever the new version asks for (config, API changes) is done in the same change, not worked around.
- **CI actions and runtimes count too:** GitHub Actions on their current major, Node on its current LTS line
  (`engines` and CI together), pnpm on its current major (`packageManager`).
- The lockfile stays committed, so an install is reproducible. Stay current by updating it on purpose, not by
  loosening ranges.

### Held back, and what to check before trying again
- **TypeScript 7** (on 6 until then): typescript-eslint, which eslint-config-next brings in, needs TypeScript's JS
  API, and 7.0 doesn't have one yet (typescript-eslint #12518, #12521). Next's build and vitest already work with 7,
  and the code passes the TS 7 checker. When TypeScript ships the API and typescript-eslint's `typescript` peer range
  includes 7, it's a version bump. As of October 2026 that range is still `<6.1.0`.
- **ESLint 10** (on 9 until then): eslint-plugin-react, eslint-plugin-import and eslint-plugin-jsx-a11y don't support
  it (react crashes on `context.getFilename`), and Next's bundled Babel parser lacks `addGlobals` (vercel/next.js
  #89764). It needs stable releases of all three plugins and an eslint-config-next that ships an ESLint 10 parser.
  ESLint 9 is marked unsupported on npm now, so it gets no more fixes: check at every batch, and move the day the
  plugins allow it. As of October 2026 all three still cap their `eslint` peer at 9.
- **Replacing ESLint, considered and passed over (October 2026).** Both holds above come in through
  eslint-config-next, which the scaffold brought and nobody chose. Oxlint would lift both: it has its own React,
  Next.js, jsx-a11y and import rules, runs eslint-plugin-react-hooks' React Compiler rules through its JS plugins,
  and its type-aware mode is built on TypeScript 7. Tried on this repo it covered 58 of our 62 rules (not
  `jsx-uses-react`, `jsx-uses-vars`, `react/no-deprecated`, `@next/next/no-location-assign-relative-destination`)
  and linted in 1.5 s against ESLint's 17 s. We stayed: lint runs only on our machines and in CI, never in what
  ships, and its JS plugins are alpha. Revisit if an advisory against ESLint 9 or its plugins goes unfixed, or if
  either hold above drags on. Biome can't run the React Compiler rules, so it isn't the alternative. TypeScript 7.1
  (in beta) gives the JS API its stable paths; typescript-eslint still has to adopt it, and a beta doesn't ship here.
