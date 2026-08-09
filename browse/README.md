# browse

Thin wrapper around the upstream [`agent-browser`](https://github.com/vercel-labs/agent-browser) Chromium CLI, tailored for this monorepo.

`bin/browse` (at the monorepo root) is the access point. Everything passes through to the upstream binary except for three additions:

- **Worktree-aware URL rewriting** — `bin/browse open /dashboard` resolves to `http://localhost:3210/<this-worktree>/<box>/dashboard`.
- **Self-describing screenshots** — `bin/browse screenshot` writes a sidecar `<image>.json` with `{url, title, timestamp, takenInWorktree}`.
- **Indexed default path** — `bin/browse screenshot` with no path saves to `.claude/screenshots/NNNN-<slug>.png`.

Cheat sheet: [`.claude/skills/browse/SKILL.md`](../.claude/skills/browse/SKILL.md).

**`BROWSE_BASE_URL`** overrides the router-derived base for a driver that owns its own server instead of going through the shared dev router (callback-box's field-test harness starts a dedicated `cb serve` on a free port). It moves both the `/`-leading path rewrite and the browse-key cookie's origin scope, so `BROWSE_BASE_URL=http://127.0.0.1:4711/box bin/browse open /` drives that server's box, authenticated, and sends the key nowhere else. Unset (normal use) changes nothing.

## Layout

```
src/                                  CLI entry, worktree detection, screenshot enhancement
packages/agent-browser-typed/         Typed TS interface to the upstream CLI surface
  src/commands/                       One typed function per upstream subcommand
  help/                               Checked-in `agent-browser <cmd> --help` snapshots
  scripts/verify-help.ts              Diffs captured vs current; reports drift
```

## Adding a typed command

1. Add `packages/agent-browser-typed/src/commands/<cmd>.ts` with a single exported function.
2. Re-export from `packages/agent-browser-typed/src/index.ts`.
3. Capture the help snapshot: `node_modules/agent-browser/bin/agent-browser-darwin-arm64 <cmd> --help > packages/agent-browser-typed/help/<cmd>.txt`.
4. `pnpm verify-help` to confirm it matches.

## Verifying upstream hasn't drifted

```bash
pnpm verify-help              # diff captured vs current; exits non-zero on drift
pnpm verify-help -- --update  # rewrite snapshots (do this only after also updating types)
```
