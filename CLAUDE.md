# Society Mahjong

## Dependencies: stay current

The policy is to run the newest stable release of everything, so the app can use what's new in each: the framework,
React, Supabase, motion, the toolchain, the CI actions, Node and pnpm. Being behind is a defect to fix, not a state to
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
  includes 7, it's a version bump.
- **ESLint 10** (on 9 until then): eslint-plugin-react, eslint-plugin-import and eslint-plugin-jsx-a11y don't support
  it (react crashes on `context.getFilename`), and Next's bundled Babel parser lacks `addGlobals` (vercel/next.js
  #89764). It needs stable releases of all three plugins and an eslint-config-next that ships an ESLint 10 parser.
