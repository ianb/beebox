# site/

The generated public front-door site for Bee Box. A static site built from
`site/cards/` to gitignored `site/dist/`, viewable on the dev router at
`/<worktree>/site/`. Its paper cards and system chrome follow the app.

Card paths, attachment parents, theme metadata, authored continuations and
the static navigation contract are documented in [card-authoring.md](card-authoring.md).
That document describes the current implementation; the earlier fisheye
experiments below remain supported inside card bodies.

**Cards are the native source format.** A page is a Bee Box card
(`<slug>.site-page.card` — YAML frontmatter + markdown body, type carried by
the filename). The repository is canonical; a local box may hold private
editorial work and expose only selected cards under `_publish/public-site/`.
`box-export.ts` validates that selected graph and copies it into `site/cards/`,
mapping the box-only `site-doc` suffix to the public `doc` suffix. See the
workbench workflow in [card-authoring.md](card-authoring.md).

- Principles (settled with the boxholder): `issues/features/2026-07-20-public-site.md`
- Full plan / tracks: `../beebox/docs/plans/public-site.md`

## Hard constraint: static output only

Everything must work under GitHub Actions + GitHub Pages. The build is a plain
generator over markdown — **no server-side anything, no live/AI wiring, and no
external requests at view time** (fonts inlined via a system stack, no CDNs, no
remote assets — the page is CSP-clean and viewable offline). The output in
`dist/` is the whole product; the router and Pages both just serve those bytes.

## Authorship is explicit

Never present agent-written prose as the boxholder's voice. Every published
page card carries a person-centered `authorship` account and explicit AI
contribution categories. Agent-drafted informational prose may publish when
that contribution is described there; prose intended to become Ian's own words
stays a visible bracketed placeholder until he replaces it.

## Deployment

The public site's deployment was configured separately. A local build or
worktree preview does not publish it; do not conflate browser verification,
committing, landing, and deployment. This package produces static artifacts
and needs no box or application server to serve them.

## Commands

```bash
pnpm --dir site build                    # base derived from the git branch (router view)
pnpm --dir site build --base /beebox/   # what the Pages workflow runs
pnpm --dir site box-export --box <path> # dry-run selected workbench cards
pnpm --dir site box-export --box <path> --apply
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

- `build.ts` — CLI entry: reads the page cards, writes HTML + `.md` twins +
  `llms.txt`, link-checks, resolves the base path. Its parameterized
  `buildSite()` core also validates temporary workbench exports.
- `box-export.ts` — fail-closed box-workbench export. Reads only
  `<box>/_publish/public-site/`; dry-runs by default; maps `site-doc` to `doc`;
  validates with `buildSite()`; `--apply` writes additions and updates but
  never deletes, commits, pushes, or deploys.
- `render.ts` — the local Markdoc pipeline + strict (zod) frontmatter parse +
  markdown rendering. `workspace.ts` supplies the card shell and
  `navigation-script.ts` its optional browser navigation. Deliberately does NOT import `workstreams-app/src/router/router-docs.ts`, whose
  router/runtime dependencies do not belong in the static-site build; this
  package declares `@markdoc/markdoc` itself. Every body goes through Markdoc's
  `validate` before transform: a malformed tag is otherwise dropped *silently*,
  so this pass is what makes a mistyped `{% aside ref … %}` a build failure
  instead of a paragraph that quietly disappeared.
- `cards.ts` — enumerates `cards/` and `.attach/` directories, split by type. Fail-closed: a `.card` of a
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
  `workstreams-app/src/router/router-site.ts` (compares it to decide whether to auto-rebuild). One
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
  review app's run files into `dev/apps/story-eval/runs/<run>/` with `docText`
  embedded. See the story-extraction subplan, Track B.
- `story/coverage.ts` — coverage-ledger CLI (`pnpm --dir site coverage`,
  `--check`): scans the (gitignored) run dirs and regenerates the tracked
  `story/coverage.json` — which docs were scanned, in which runs/variants, and
  whether the scanned content still matches disk (`--check` reports drift,
  nonzero exit if any). The ledger is the only committed record of the runs.

## Agent docs (`/docs/`, `llms.txt`)

A second, machine-facing corpus at `/docs/` plus a replaced `llms.txt`, for a
general chatbot fetching on behalf of someone deciding whether to use Bee Box.
Full design: `../beebox/docs/plans/agent-docs.md`; content conventions for
authors: `docs-authoring.md`. Built by `docs.ts` (`buildDocsCorpus`, split
across `docs-types.ts`, `docs-scrub.ts`, `docs-links.ts`, `docs-manifest.ts`,
`docs-generated.ts`, `docs-authored.ts`, `docs-compared.ts`, `docs-index.ts`),
called once from `build.ts` and skipped for box-export dry-runs
(`buildAgentDocs: false`).

**Three source kinds, one published set.** Authored (`docs/**/*.md`, mirroring
the published tree, frontmatter `description:` and — under `compared/` only —
a `compared:` block); promoted (`docs-manifest.yaml`, one line per admitted
repo file — the loader hard-codes both the admissible source prefixes and the
admissible publish directories, so a manifest entry outside either fails the
build regardless); generated (`beebox/scripts/export-box-docs.ts`, run via
`pnpm --dir beebox exec tsx` on every build — no filesystem side effect, ~1s —
producing `reference/` and `reference/cards/`).

**The scrub gate** (`docs-scrub.ts`) runs on every doc kind before it reaches
`dist/docs/`: a real home path (reusing `bin/path-leak-check.ts`'s `HOME_PATH`
and `ALLOWED_NAMES`), `private-issues`, or a named box under a boxes directory
(`~/src/boxes/<name>`, `/home/<user>/boxes/<name>`; `test1`, tooling folders,
the `example-names.md` roster, and placeholders pass) fails the build naming
file:line. Authored docs are additionally scanned against the developer's
gitignored `.commit-blocklist` (found the way the commit hook finds it: the
worktree's copy, else the main checkout's; `!` allows and `file:` ignores
honored). Promoted and generated docs are not: their text passed the hook's
staged-addition scan when it entered the repo, and a whole-file rescan trips
on English words that collide with a personal regex. The gate is mechanical —
paths and names, not tone — so a hit in a generated doc means the
*generator's* wording needs to lose the literal, not that the gate should be
loosened. Cloudflare has no blocklist, so that half of the gate is local-only.

**Links** (`docs-links.ts`): a promoted doc's relative link into the published
set rewrites to a relative published URL; into an excluded root (`plans/`,
`issues/`, `research/`, …) flattens to its link text; any other tracked repo
file rewrites to a GitHub blob URL; a nonexistent target fails the build. An
authored doc's links are already published-relative — the build only
validates they resolve within the published set (including the generated
per-directory `index.md` files).

**Adding a doc:** authored — add the `.md` under `docs/` mirroring where it
should publish, with `description:` frontmatter (and `compared:` if it's under
`compared/`); a new directory needs a `docs/<dir>/index.md` stub too (frontmatter
`description:` only — the *published* index.md is always generated, never
authored). Promoted — add a line to `docs-manifest.yaml`; that line is the
vetting act. Generated — nothing to do; it tracks the engine.

**Dev-router staleness.** The Cloudflare build always runs the export script,
so it's never stale. The dev router rebuilds from the input manifest without
running the export, so its `reference/` set can lag an engine edit until the
next explicit `pnpm --dir site build` or a `generateDocs` run refreshes
`beebox/box-docs/.hash` (which `sources.ts` folds into the manifest, tolerating
its absence). Accepted as dev-only staleness.
