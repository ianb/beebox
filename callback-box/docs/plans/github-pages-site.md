# GitHub Pages front-door site

A static public site for callback-box, generated from repo content, deployed to
GitHub Pages, and viewable on the dev router. The design principles were settled
with the boxholder in discussion (recorded in
[the issue](../../../issues/features/2026-07-20-github-pages-site.md)): spare and
antiprofessional to start, iterating toward "cool in a different way";
the boxholder's words carry the human-facing page (AI structure fine, AI words
not); a visibly separate machine-facing layer for agents (llms.txt, markdown
twins); everything static and precalculated; content sourced from the repo
(issues, plans, docs) via a nugget-extraction-with-reinterpretation pipeline;
nonlinear "fisheye" (telescopic, expand-in-place) presentation as the design
exploration.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — traced below by number, chiefly:
  **3** (validate at boundaries — nugget frontmatter and staleness checked at
  build), **4** (resilient AND never silent — a drifted source never renders
  as if current), **8** (one way to do each thing — reuse the router's
  Markdoc/frontmatter machinery rather than a second parser), **11**
  (enforcement beats convention — the AI-words rule is enforced by the
  generator, not hoped for), **12** (the maintainer is usually an agent).
- Root `CLAUDE.md`: the deploy-hook path scoping ("Auto-deploy is `main`-only,
  and only for deployed paths"), path-leak-check ("docs are the main leak
  surface"), the lint-rule prohibition, "Treat noisy command output as a bug."
- `issues/features/2026-07-05-writing-skill.md` — the governing rule
  ("opinionated in conversation and conservative in the artifact") and the
  structure-vs-words line: *"AI _structure_ can be fine, but AI _words_ not so
  much"* (boxholder, applied to this site explicitly).
- Precedent: `2026-07-20-agent-maintained-security-report.md` — the
  committed-prompt → generated-artifact → auditable-process pattern; this
  site's nugget staleness contract is the same shape.
- Boxholder feedback memories: bias toward strict / fail-closed; scratch
  artifacts in `scratch/`; TypeScript only.

## What already exists

- **Markdoc rendering**: `bin/router-docs.ts:198-202` —
  `renderMarkdownToHtml(src)` wraps `Markdoc.parse → transform →
  renderers.html` plus `highlightCodeBlocks` (hljs) and `autolinkUrls`.
  **Reuse** for rendering markdown sources; the site gets its own HTML shell
  (the router's `renderDevShell` styling is dev-tool chrome, not the site's
  register). Markdoc is currently declared only in
  `callback-box/package.json:103` and the frontend — `bin/` imports it via
  hoisting; the site build must declare its own dependency rather than extend
  that accident (principle 11).
- **Issue frontmatter parser**: `bin/router-issues.ts` — `IssueFrontmatter`
  (lines 19-27) and a hand-rolled `parseFrontmatter` (≈line 65) covering the
  YAML subset issues actually use, plus `CATEGORIES` (line 16). **Reuse** by
  extracting to a shared module both the router and the generator import
  (principle 8 — one frontmatter parser, not two).
- **Static serving from disk, no cold start**: `bin/router-docs.ts:609-663`
  (`serveDevArtifact`) is the pattern for the router serving the built site
  straight from disk. **Reuse the pattern** with a new route (see Track B).
- **Deploy hooks won't fire**: `.husky/post-commit:31-33` /
  `.husky/post-merge:22-23` gate on
  `^(callback-box|agent-doctest|personal-vibe-check|patches)/` + root pnpm
  files — a top-level `site/` matches nothing, so site commits never trigger
  the box deploy. No change needed; the Pages deploy is a separate GitHub
  Actions workflow (none exist today — no `.github/` directory).
- **doc-check**: `callback-box/src/dev/doc-check.ts` sweeps repo-wide markdown
  for broken references and duplicate issue basenames (its orphan check is
  scoped to `docs/`-prefixed paths only, line 90). `site/*.md` sources get
  link validation for free; no orphan burden.
- **Content hashing / staleness precedent**:
  `callback-box/src/lib/content-hash.ts:9-11` (`contentHash` — sha256/16) and
  the template-stock pattern (`src/core/template-stock-hashes.ts`:
  current-hash + superseded list, consumed at
  `install-template-file.ts:357-364`). **Reuse `contentHash`**; the nugget
  ledger adapts the pattern (hash of the source span at extraction time).
- **TS execution convention**: `tsx` everywhere
  (root scripts use `node --import tsx bin/*.ts`;
  `callback-box/package.json:63` `"doc-check": "tsx src/dev/doc-check.ts"`).
  The generator follows suit.
- **Tours** (`callback-box/test/tours/`, artifacts gitignored per
  `docs/tours.md:39-50`) — the future automated-screenshot pipeline if
  screenshots ever land ("something fancier and more automated" — boxholder).
  Not used in this plan; cited so the hook point is known.
- **Repo identity**: remote is `github.com/ianb/callback-box` → default Pages
  URL `ianb.github.io/callback-box` (base path `/callback-box/`), unless a
  custom domain is chosen (open question).

## Prior art (external)

Verified 2026-07-21 (URLs fetched):

- **Telescopic text lineage**: Joe Davis's
  [telescopictext.org](https://www.telescopictext.org/);
  [StretchText](https://en.wikipedia.org/wiki/Stretchtext) (Nelson);
  [Matuschak's stacked notes](https://notes.andymatuschak.org/About_these_notes);
  [Tufte-CSS sidenotes](https://github.com/edwardtufte/tufte-css) as the
  non-inline alternative. No formal UX study of expand-in-place prose failure
  modes found — "losing your place"/depth vertigo are design risks we carry
  without literature to lean on.
- **`<details>` inline limitation**: the HTML parser forces `<details>` to
  block flow inside `<p>`
  ([css-tricks](https://css-tricks.com/two-issues-styling-the-details-element-and-how-to-solve-them/))
  — mid-sentence expansion needs custom elements/JS with `aria-expanded`, or
  expansion only at clause/paragraph boundaries.
- **`hidden=until-found`**: collapsed content stays find-in-page-searchable
  and indexable; supported Chrome 97+, Firefox 139+, Safari 26.2+
  ([Chrome docs](https://developer.chrome.com/docs/css-ui/hidden-until-found)).
  This resolves the biggest a11y/searchability objection to telescopic depth.
- **llms.txt**: [spec](https://llmstxt.org/) (H1 + blockquote + H2 link
  sections; `llms-full.txt` is convention, not spec). Honest adoption
  picture: major crawlers largely don't fetch it and Google says zero SEO
  effect ([analysis](https://www.digitalapplied.com/blog/google-llms-txt-no-seo-value-lighthouse-audit-2026));
  the real consumers are coding/IDE agents pointed at a site — which is
  exactly this site's stated agent audience, so we adopt it for that use, not
  for crawlers. Markdown twins (`.md`-suffix URLs) are an informal convention
  (Cloudflare docs et al.), no formal spec.
- **Pages via Actions**: `actions/upload-pages-artifact` +
  `actions/deploy-pages` (permissions `pages: write`, `id-token: write`) is
  the current recommended no-committed-dist path
  ([GitHub docs](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)).
  Pitfalls: with Actions deploys a custom domain's `CNAME` must be inside the
  artifact; project sites serve under `/<repo>/`, so the generator needs a
  base-path config baked at build.
- **Repo-issue-queue as public site**: no prior art found — open ground. The
  nearest provenance pattern is git-revision-date plugins
  ([mkdocs plugin](https://github.com/timvink/mkdocs-git-revision-date-localized-plugin));
  a "generated from commit X" footer is bespoke, which is fine.
- **Fisheye applied to prose**: Furnas
  [Generalized Fisheye Views, CHI 1986](https://dl.acm.org/doi/10.1145/22627.22342)
  is the frame; no shipped prose-reading instantiation found. Also open
  ground.

## Tracks / scope

Ordered by implementation dependency, then surface size.

### Track A — generator skeleton (`site/`)

- **What**: top-level `site/` with sources (`site/content/`), a TypeScript
  generator (`site/build.ts`, run via tsx), and gitignored output
  (`site/dist/`). The generator reads markdown + frontmatter, renders through
  Markdoc, applies the site shell (spare: readable margins, specified
  non-Courier fonts, no colors yet), and emits static HTML plus the machine
  layer (llms.txt, per-page `.md` twins).
- **Why**: everything else (router serving, Pages deploy, nuggets, fisheye)
  consumes this.
- **Direction**: base path is a build input (`--base /callback-box/` for
  Pages, `--base /<worktree>/site/` for the router, `/` for a custom domain).
  Internal links are emitted resolved against the base — never hand-relative.
  Shared frontmatter parser extracted from `bin/router-issues.ts` to a module
  both import. `site/` gets its own `package.json` in the workspace, on the
  vibe-check preset, declaring `@markdoc/markdoc` explicitly.
- **First chunk**: `site/` package + build.ts rendering one placeholder page
  from `site/content/index.md` to `site/dist/` with base-path handling and a
  link-check pass over the output. No open questions inside.

### Track B — dev-router route

- **What**: the router serves `site/dist/` statically at
  `/<worktree>/site/`, same never-cold-start pattern as `serveDevArtifact`
  (`bin/router-docs.ts:609-663`): pure disk reads, `cache-control: no-store`,
  404 when `dist/` is absent (with a one-line "run pnpm --dir site build"
  body — resilient and not silent, principle 4).
- **Why**: boxholder requirement — "the site should be viewable on the dev
  router."
- **Direction**: no on-demand building in the router (keeps the router
  request-path pure); rebuilds are explicit (`pnpm --dir site build`, plus an
  optional watch script). Router changes ride the usual
  main-merge-then-restart lifecycle (`bin/CLAUDE.md`).
- **First chunk**: the route + 404 message + a router test alongside the
  existing router test setup.

### Track C — v1 content: the letter, links, machine layer

- **What**: one human page — the boxholder's letter — plus links (repo,
  Zulip at callback-box.zulipchat.com, install docs), and the agent layer:
  `llms.txt` indexing the machine-facing files (agent-install.md, SECURITY.md
  when it exists, export/instruction docs), with `.md` twins for every human
  page.
- **Why**: this is the site's whole v1 value; the "cool" iterates later on
  top of it.
- **Direction**: the letter's words are the boxholder's, produced through the
  writing practice (its first dogfood, per
  `issues/features/2026-07-05-writing-skill.md` scope note). Until they
  exist, the page carries an honest explicit placeholder — agent-written
  scaffolding *marked as placeholder*, never passing as his voice (the
  writing-skill governing rule). Machine-facing files are sourced from their
  repo homes at build (single source of truth in `callback-box/docs/`), not
  forked into `site/content/`.
- **First chunk**: page structure + links + llms.txt generation with the
  marked placeholder letter.

### Track D — Pages deploy workflow

- **What**: `.github/workflows/pages.yml` — on push to `main` affecting
  `site/` or its sources: pnpm install, `site` build with
  `--base /callback-box/`, `upload-pages-artifact` → `deploy-pages`.
- **Why**: "We probably should be generating the site on deploy" — no
  committed dist, no gh-pages branch.
- **Direction**: path-filtered trigger plus `workflow_dispatch` for manual
  runs. Since nuggets source from `issues/` and docs, the path filter
  includes those source globs — accepting that issue churn redeploys the
  site (cheap, and it's what keeps staleness badges current). Build failure
  leaves the previous deploy live and shows red in Actions (visible, not
  silent).
- **First chunk**: the workflow, landed together with the rest of the plan
  (it only activates on merge to main; Pages must also be flipped to
  "GitHub Actions" source in repo settings — a manual boxholder step, noted
  in rollout).

### Track E — nugget pipeline (extraction with reinterpretation)

- **What**: nuggets are committed files (`site/nuggets/<slug>.md`) with
  frontmatter: `source` (repo-relative path), `span` (the quoted text or
  anchor), `sourceHash` (contentHash of the span at extraction),
  `status: proposed | reinterpreted | excerpt`, and body = the publishable
  text (the boxholder's rewrite, or the verbatim excerpt). Extraction is an
  *editorial session* (agent/subagent grunt work producing `proposed`
  nuggets for the boxholder to reinterpret), never a build step — the build
  only renders.
- **Why**: "extracting ideas from the source, issues, plans, documents" with
  the AI-ideas danger handled by "nuggets that I'm asked to reinterpret."
  And this is the site's substance, not decoration: the extracted ideas are
  "the-story-of-callback-box, which is kind of the point of the page"
  (boxholder, 2026-07-21) — the decisions made, the tensions held, why the
  system is shaped the way it is. The letter is the entry; the story is the
  body.
- **Direction — the enforcement (principle 11)**: the generator **refuses to
  render `status: proposed`** nuggets — the AI-words rule is code, not
  convention. At build, each nugget's source span is re-hashed:
  match → renders with provenance ("from `<source>`"); drift → renders with
  a visible stale marker; source file missing → **build fails** (fail-closed).
  This is the site's version of the security-report auditable-process
  pattern.
- **First chunk**: nugget schema + loader + the three enforcement behaviors
  with tests, exercised by one hand-made fixture nugget. Real extraction
  sessions follow as content work, not code work.

### Track F — fisheye / telescopic presentation

- **What**: expand-in-place depth — "infinite chained footnotes… like a wiki,
  but visually different structure." The letter is the surface; expandable
  spans open nuggets and repo content inline, which may themselves contain
  further expansions.
- **Why**: this is the designated route to "cool in a different way" —
  structural, true, and (per prior art) genuinely unoccupied ground.
- **Direction**: semantic HTML first — expansion at clause/paragraph
  boundaries using `<details>`-like disclosure with `hidden=until-found` so
  collapsed depth stays searchable; `aria-expanded` semantics; all text
  shipped in the page (agents and no-JS readers see everything — the `.md`
  twin is the flat form). A Markdoc tag (e.g. `{% expand nugget="slug" %}`)
  authors the expansion points in the letter source.
- **This track starts as a standalone prototype page** the boxholder reacts
  to before it's woven through the letter — taste calls (visual treatment,
  depth cues, how compression reads) are his to anchor, and a prototype is
  cheaper than a debate. The prototype is a spike; its survival gates the
  integration chunk.
- **First chunk**: the prototype page under `site/` (built by the normal
  generator, linked nowhere), using real nuggets from Track E fixtures.

## Subplans

None yet. If the Track F prototype surfaces enough design (interaction
grammar, authoring vocabulary) to need its own decision table, spin
`github-pages-site-fisheye.subplan.md` at that point rather than inflating
this plan speculatively.

## Failure modes

**Critical gap: none unresolved** — the AI-words leak and silent-drift rows
below were the candidates; both are handled in code by Track E's enforcement.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A `status: proposed` nugget reaches the published site (AI words passing as content) | planned (Track E chunk) | generator refuses to render `proposed` | clear — build lists the refused slugs |
| Nugget's source span edited after extraction | planned | re-hash at build → visible stale marker | clear — marker on the page + build summary line |
| Nugget's source file deleted/moved | planned | build fails naming the nugget and missing path | clear |
| Base-path mismatch (works on router, broken links on Pages `/callback-box/`) | planned — link-check runs against both base configs | links emitted via base-path resolver only | clear — link-check fails the build |
| Pages workflow build fails on main | n/a (CI itself) | previous deploy stays live | clear — red Actions run |
| Malformed frontmatter in a nugget/content file | planned | parse errors fail the build with file+line | clear |
| Markdoc renders odd markdown to broken HTML silently | partial — link-check catches broken hrefs, not layout | accepted residual: visual review on the router | semi-silent, accepted (low stakes, human-reviewed surface) |
| Router serves stale `dist/` after source edits | no test | `no-store` headers + explicit-rebuild model; 404-with-hint when dist absent | semi-silent, accepted — dev-only surface, same as any build artifact |
| Path/PII leak via published repo content | existing — `path-leak-check` pre-commit covers all tracked files incl. `site/` | yes | clear |
| `hidden=until-found` unsupported in an old browser | no | depth still expandable by click; content in DOM | silent degradation, accepted |

## Agent-flow / user-flow edge cases

The template's seven scenarios, adapted — this is dev-repo tooling, not box
machinery, so several translate rather than apply directly:

- **Wrong tag / wrong field** — an agent authors `{% expand %}` pointing at a
  nonexistent nugget slug: **ADDRESSED** — build fails on unresolved slugs
  (same fail-closed row as missing sources).
- **Stale ref** — nugget → source drift: **ADDRESSED** (Track E staleness
  contract).
- **Two agents touching the same content** — site builds only from committed
  state; concurrent worktree edits resolve through git as usual:
  **ADDRESSED** by construction.
- **Hand-edit drift** — boxholder hand-edits a nugget's frontmatter
  imperfectly: **ADDRESSED** — the shared parser + build-time validation
  fail with file+line (principle 3).
- **Fabricated free-form value** — an extraction agent invents an "idea" not
  in the source: **ADDRESSED structurally** — `source` + `span` +
  `sourceHash` are required, and the hash must match real file content at
  build; a fabricated span can't hash-match. The *reinterpretation* step is
  the human backstop for subtler misreadings.
- **Validation error UX** — build errors name file, line, and the failing
  rule in one line each (no stack-trace noise — "noisy command output is a
  bug"): **ADDRESSED** as a stated requirement of the generator.
- **Partial migration / transition state** — no existing data changes shape:
  **not applicable**, stated explicitly.

## NOT in scope

- **Live AI wiring** — the site is static and precalculated; boxholder:
  "I don't want it to be wired up to AI."
- **Screenshots / demo video** — only lands as an automated pipeline
  ([regenerable-app-demo-video](../../../issues/features/2026-07-17-regenerable-app-demo-video.md)),
  a separate effort; Track A's shell leaves room for exhibits.
- **The ongoing agent-maintained regeneration loop** (security-report-style
  cadence) — "we'd have to bootstrap it first"; this plan is the bootstrap.
- **Embeddings** (clustering, related-nugget links) — later iteration once
  there are enough nuggets to relate.
- **Bold colors / visual ambition** — "something we'd add not start with";
  v1 ships spare.
- **Composing the letter inside a callback box** — boxholder is considering;
  the plan takes the letter's text however it's produced.
- **Porting the nugget practice into callback-box itself** — acknowledged as
  "really a callback box feature"; prototype here, file the box feature when
  it proves out.
- **Custom domain purchase/decision** — open question; the build's base-path
  config makes either answer cheap later.

## Open design questions

- **The letter itself** — content and when the boxholder's words arrive via
  the writing practice. The site frame doesn't wait (marked placeholder),
  but v1 isn't *shown to anyone* until the letter is real.
- **Custom domain vs `ianb.github.io/callback-box`** — lean: default project
  URL for v1 (zero cost, honest register); revisit if the site becomes the
  canonical link target.
- **Fisheye interaction specifics** — deliberately deferred to the Track F
  prototype; deciding them in prose now would be planning past the taste
  checkpoint.
- **Which corpora get extraction sessions first** — given the
  story-of-callback-box framing, lean: `issues/decisions/` (including closed
  ones — decisions are the story's beats), the `research/` syntheses (why
  the bets look like they do), then plans/implemented-plans. Git history
  itself is a candidate corpus for later sessions.
- **Nugget slug/vocabulary conventions** — settled inside Track E's first
  chunk before any real extraction session runs.

## Knowledge audits

Skip, with rationale: this plan introduces no box-agent-facing concepts — no
new tags, card shapes, or box conventions. The nugget lifecycle and
`{% expand %}` tag are *dev-repo* authoring conventions, documented in
`site/README.md` (which doc-check will keep referenced); knowledge-audits
verify what *box* agents recall, and no box agent touches this machinery. If
the nugget practice later migrates into callback-box as a feature, that
feature's plan owns the audits.

## Implementation order

1. **A1** — `site/` package, generator with base-path + link-check,
   placeholder index. (Unblocks everything.)
2. **B1** — router route serving `site/dist/` + test.
3. **C1** — v1 page structure, links, llms.txt + `.md` twins, marked
   placeholder letter.
4. **D1** — Pages workflow (inert until merge; settings flip at rollout).
5. **E1** — nugget schema, loader, enforcement (proposed-refusal, stale
   marker, fail-on-missing) + tests + one fixture nugget.
6. **F1** — fisheye prototype page; boxholder reacts. (Spike gate.)
7. **F2** — integrate the surviving interaction into the letter via
   `{% expand %}`; extraction sessions produce real `proposed` nuggets;
   boxholder reinterprets; publish.
8. Letter lands (whenever the words are ready) — replaces the placeholder.

Chunks 1–5 are mechanical and sequential; 6–8 are where taste checkpoints
live. Commit per chunk in this worktree; nothing merges to main until the
boxholder says ship.

## Rollout shape

- **Tests as design tools**: the generator's substantial codepaths each get a
  named test written with the chunk — `base-path link integrity` (build under
  both bases, assert zero broken internal links), `proposed nuggets never
  render`, `stale source → marker present`, `missing source → build fails`,
  `frontmatter errors name file+line`. Test harness: whatever `bin/`-adjacent
  tooling already uses (to be confirmed at A1 — not assumed here); plain
  vitest is the fallback.
- **Manual step at ship**: repo Settings → Pages → source = GitHub Actions
  (boxholder or agent-with-gh, one-time), and confirming the first green
  deploy at `ianb.github.io/callback-box`.
- **No data migration** — nothing existing changes shape.
- **Post-ship**: the site iterates in place (colors, exhibits, more nuggets);
  the agent-maintained cadence question reopens only after the bootstrap has
  lived for a while — per the NOT-in-scope entry.
