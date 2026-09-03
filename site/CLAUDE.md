# site/

The generated public front-door site for beebox. A spare static site
built from `site/content/*.md` to gitignored `site/dist/`, deployed to GitHub
Pages and viewable on the dev router at `/<worktree>/site/`.

- Principles (settled with the boxholder): `issues/features/2026-07-20-public-site.md`
- Full plan / tracks: `../beebox/docs/plans/public-site.md`

## Hard constraint: static output only

Everything must work under GitHub Actions + GitHub Pages. The build is a plain
generator over markdown — **no server-side anything, no live/AI wiring, and no
external requests at view time** (fonts inlined via a system stack, no CDNs, no
remote assets — the page is CSP-clean and viewable offline). The output in
`dist/` is the whole product; the router and Pages both just serve those bytes.

## Human prose is the boxholder's words only

Agents never fill in his voice. Any human-facing prose an agent writes is a
**marked placeholder** (a visible bracketed editorial note, impossible to
mistake for him) that his real words replace later. Structure/scaffolding by
agent is fine; words are not. This is enforced by keeping placeholders marked,
not hoped for.

## Repo is private today

Pages cannot publish until the repo is public AND Settings → Pages → Source is
switched to "GitHub Actions" — a manual boxholder step tracked in
`../issues/docs-and-chores/2026-07-21-pages-site-go-live.md`. Until then the dev
router route is the only live view. The Pages workflow
(`../.github/workflows/pages.yml`) is landed but inert.

## Commands

```bash
pnpm --dir site build                    # base derived from the git branch (router view)
pnpm --dir site build --base /beebox/   # what the Pages workflow runs
pnpm --dir site lint                     # eslint (roots: ["."] — sources at package root)
pnpm --dir site typecheck                # tsc --noEmit
pnpm --dir site test                     # node --test over *.test.ts
```

View on the router at `http://localhost:3210/<worktree>/site/`. An explicit
build is **optional for router viewing**: the router auto-builds on request when
`dist/` is missing or its input manifest (`dist/.inputs.json`) doesn't match the
current sources — content-hash based, so it's never-stale and deletion-correct
(boxholder: "I don't want stale builds"). Builds are serialized per checkout and
a failure surfaces as a 500 with the build's error text. The Pages workflow
still builds explicitly (with `--base /beebox/`). Run `pnpm --dir site
build` yourself when you want to see build errors directly.

The build fails closed: malformed frontmatter (named file:line), a broken
internal link, or a missing source stops it. On success it prints one line and
writes the input manifest last (so a partial build never masks staleness).

## Layout

- `build.ts` — CLI entry: reads content, writes HTML + `.md` twins + `llms.txt`,
  link-checks, resolves the base path.
- `render.ts` — the local Markdoc pipeline + strict (zod) frontmatter parse +
  the HTML shell. Deliberately does NOT import `workstreams-app/src/router/router-docs.ts`, whose
  router/runtime dependencies do not belong in the static-site build; this
  package declares `@markdoc/markdoc` itself.
- `links.ts` — base-path handling and internal-link resolution.
- `sources.ts` — the single definition of the input source set + content-hash
  manifest, shared by `build.ts` (writes `dist/.inputs.json`) and
  `workstreams-app/src/router/router-site.ts` (compares it to decide whether to auto-rebuild). One
  enumeration, so the two sides can't drift.
- `content/` — markdown sources (frontmatter: `title`, `summary`).
- `story/ingest.ts` — story-extraction ingest CLI (`pnpm --dir site ingest`,
  `--help`): validates raw extraction JSON (strict zod), verifies every span
  appears verbatim in its source (fabrication = hard error), and writes the
  review app's run files into `dev/apps/story-eval/runs/<run>/` with `docText`
  embedded. See the story-extraction subplan, Track B.
- `story/coverage.ts` — coverage-ledger CLI (`pnpm --dir site coverage`,
  `--check`): scans the (gitignored) run dirs and regenerates the tracked
  `story/coverage.json` — which docs were scanned, in which runs/variants, and
  whether the scanned content still matches disk (`--check` reports drift,
  nonzero exit if any). The ledger is the only committed record of the runs.
