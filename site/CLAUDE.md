# site/

The generated public front-door site for callback-box. A spare static site
built from `site/cards/*.card` to gitignored `site/dist/`, deployed to GitHub
Pages and viewable on the dev router at `/<worktree>/site/`.

**Cards are the native source format.** A page is a callback-box card
(`<slug>.site-page.card` — YAML frontmatter + markdown body, type carried by
the filename) in exactly the shape a box authors it, so a page moves box → repo
as a verbatim file copy. There is no importer and no conversion step; the box →
repo transfer is a plain file copy today, and *where* these cards should live
long-term (repo, box export, something else) is an open question — see the
"Direction shift (2026-08-19)" section of the plan.

- Principles (settled with the boxholder): `issues/features/2026-07-20-public-site.md`
- Full plan / tracks: `../callback-box/docs/plans/public-site.md`

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
pnpm --dir site build --base /callback-box/   # what the Pages workflow runs
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
still builds explicitly (with `--base /callback-box/`). Run `pnpm --dir site
build` yourself when you want to see build errors directly.

The build fails closed: malformed frontmatter (named file:line), a broken
internal link, or a missing source stops it. On success it prints one line and
writes the input manifest last (so a partial build never masks staleness).

## Layout

- `build.ts` — CLI entry: reads the page cards, writes HTML + `.md` twins +
  `llms.txt`, link-checks, resolves the base path.
- `render.ts` — the local Markdoc pipeline + strict (zod) frontmatter parse +
  the HTML shell. Deliberately does NOT import `bin/router-docs.ts`, whose
  router/runtime dependencies do not belong in the static-site build; this
  package declares `@markdoc/markdoc` itself. Every body goes through Markdoc's
  `validate` before transform: a malformed tag is otherwise dropped *silently*,
  so this pass is what makes a mistyped `{% aside ref … %}` a build failure
  instead of a paragraph that quietly disappeared.
- `cards.ts` — enumerates `cards/`, split by type. Fail-closed: a `.card` of a
  type the site doesn't build, or a stray non-card file, is a named error, never
  a silently unpublished page.
- `asides.ts` — the `site-aside` registry, the `{% aside ref="slug" /%}`
  substitution, and the author-voice enforcement: a `pending` `author` aside
  publishes the standard placeholder and NEVER its own body (agent prose in an
  open elicitation cannot ship); any other empty-bodied aside, an unknown ref,
  or an aside body that refs another aside fails the build. Referenced and
  inline asides render through the one shared `asideTag` helper in `fisheye.ts`,
  so the two forms cannot drift into different markup.
- `links.ts` — base-path handling and internal-link resolution.
- `sources.ts` — the single definition of the input source set + content-hash
  manifest, shared by `build.ts` (writes `dist/.inputs.json`) and
  `bin/router-site.ts` (compares it to decide whether to auto-rebuild). One
  enumeration, so the two sides can't drift.
- `cards/` — the page and aside sources. `<slug>.site-page.card` builds
  `<slug>.html` (fields: `title`, `summary`, optional `unlisted` to keep a page
  out of llms.txt, optional `contains` tolerated as a box-global field and never
  published); `<slug>.site-aside.card` is the registry `{% aside ref %}`
  resolves against (fields: `kind` bee/author/generated, `label`, `status`
  pending/ready, optional `generated-from`, optional `contains`).
- `fisheye.ts` — the expand-in-place vocabulary (plan Track F): the
  `{% expand label="…" %}` Markdoc tag (inline → button + `hidden=until-found`
  span; block → native `<details>`) and the `{% nugget slug="…" /%}` embed
  placeholder that `embedNuggets()` (nuggets.ts) substitutes at build, failing
  on unknown slugs — plus `{% aside kind="bee|author|generated" label="…" %}`,
  a categorized aside whose kind is a voice with visible provenance (`author`
  content is the boxholder's words only) in either of two mutually exclusive
  forms — `kind` + `label` + an inline body, or a bare `ref` resolved from a
  card. `cards/fisheye.site-page.card` and `cards/walkthrough.site-page.card`
  are the unlisted prototype pages.
- `nuggets/<slug>.md` — committed excerpts of repo content: frontmatter `source`
  (repo-relative, restricted to `issues/`, `callback-box/docs/`, `research/`,
  root `README.md`), `span` (a verbatim excerpt of that source), and
  `status: proposed | reinterpreted | excerpt`; the body is the publishable text
  (empty only for `excerpt`, where the span is the content).
- `nuggets.ts` — the nugget loader and its enforcement: `proposed` (agent words
  the boxholder hasn't reinterpreted) never renders and the build lists the
  refused slugs; each span is re-located in its source at build — exactly one
  verbatim match is current, zero or many render a visible stale marker; a
  missing or non-allowlisted source fails the build. `sources.ts` folds both the
  nugget files and every source they cite into the input manifest, so editing a
  cited doc rebuilds and the stale marker can actually appear.
- `story/ingest.ts` — story-extraction ingest CLI (`pnpm --dir site ingest`,
  `--help`): validates raw extraction JSON (strict zod), verifies every span
  appears verbatim in its source (fabrication = hard error), and writes the
  review app's run files into `dev/story-eval/runs/<run>/` with `docText`
  embedded. See the story-extraction subplan, Track B.
- `story/coverage.ts` — coverage-ledger CLI (`pnpm --dir site coverage`,
  `--check`): scans the (gitignored) run dirs and regenerates the tracked
  `story/coverage.json` — which docs were scanned, in which runs/variants, and
  whether the scanned content still matches disk (`--check` reports drift,
  nonzero exit if any). The ledger is the only committed record of the runs.
