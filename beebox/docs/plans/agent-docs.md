---
title: "Agent documentation"
status: draft
workstream: agent-docs
issues:
  - ../../../issues/features/2026-09-12-agent-documentation.md
---
# Agent documentation

A public, browsable, plain-markdown corpus about Bee Box, built for a
general chatbot rather than for Claude Code. A person pastes one prompt into
ChatGPT (or any model that can fetch URLs), the model fetches
`https://beebox.run/llms.txt`, and from there fetches what it needs to answer
questions about the project. This is not the human site
([public-site.md](public-site.md)); it is the machine layer that site's
principles already call for ("two audiences, visibly separated"), grown from a
seven-line index into a real corpus.

Design constraints, from the boxholder's framing:

- **Consumer is a general chatbot.** Public stable URLs, plain markdown, an
  entry point small enough for one fetch, enough structure to choose the next
  fetch. No Claude Code assumptions.
- **Completeness beats curation.** The site is spare on purpose; this is not.
- **Hierarchy is a requirement.** The failure modes are a flat dump and a tree
  so deep the model gives up before substance. Target: everything within two
  hops of `llms.txt`.
- **Vetting is an explicit act.** Nothing from a real box reaches a public file
  without a scrub; the boundary is enforced in the build, not re-judged per
  file.

## What already exists (verified 2026-09-12)

- **`site/build.ts`** emits an HTML page and a `.md` twin per page card and
  generates `dist/llms.txt` from the built set. `unlisted` keeps a page out of
  the index. `.md` twins are reached via `llms.txt`, not human links
  (`site/links.ts`). Content-hash input manifest (`site/sources.ts`) makes
  the router auto-rebuild and never serve stale. Fail-closed link check.
- **`site/agent-prompt.ts`** renders a titled, id-addressed, copyable
  agent-directed prompt block. The home card already carries
  `{% agent-prompt id="install-with-your-agent" %}` pointing at
  `raw.githubusercontent.com/.../agent-install.md`.
- **`beebox/box-docs/`** (gitignored, ~5,300 lines, 66 files) is a generated
  reference corpus that is a pure function of the engine source:
  `bbx-commands.md`, `connectors.md`, `procedures.md`, `triage.md`,
  `views.md`, one `card-<type>.md` per built-in schema with `instructions`
  (55 types), the prose docs from `docs/box/`, and a `README.md` index whose
  rows say *when to read* each doc. Writer: `ensurePackageDocs()` in
  `src/core/docs-gen/package-docs.ts`; standalone entry:
  `scripts/build-box-docs.ts`. No box content by construction. This is the
  largest single piece of the corpus and it cannot drift.
- **`beebox/docs/`** flat: 67 files, ~21k lines. Roughly 44 are reference
  ("how it works now"): card format, box layout, connectors and their setup,
  triage, questions, procedures, landmarks, scheduler, migrations, secrets,
  model policy, security overview, the mobile and scan-upload contracts, the
  three install guides, glossary. Plus `docs/design/` (10 files, the *why*)
  and `docs/architecture/` (9 files, the onboarding narrative, fictional
  family). The rest is dev process (testing, tours, server operations) or
  internal record (stack-decisions, reports, doc-graph).
- **`beebox/docs/plans/` (74), `implemented-plans/` (151), `issues/`,
  `research/`, `private-issues/`**: internal. Cite real boxes by name,
  reference private material, record decisions written for us. Never
  published by this plan.
- Leak scan of the candidate set: `scheduler.md` names a real box in an
  example; `prompt-logging.md` shows `/Users/...` as a redaction example;
  `doc-graph.md` mentions `private-issues`. `box-docs/` has two benign hits
  (`/Users/you`, `~/src/boxes/scenarios/`). The mechanical scrub below catches
  all of these.
- Deploy: Cloudflare Pages Git integration builds `main` with
  `pnpm install --frozen-lockfile && pnpm --dir site build --base /`, output
  `site/dist`. `beebox.run` is the canonical host
  ([go-live issue](../../../issues/docs-and-chores/2026-07-21-pages-site-go-live.md)).
  So the site build has the whole monorepo and its dependencies available.

## The hierarchy

Two hops from the entry point to any leaf. Section indexes exist only where a
section is too large to list inline in `llms.txt`.

```
/llms.txt                         entry: what this is, how to use it, sections
/docs/orientation/<name>.md       what Bee Box is; vocabulary; the why
/docs/install/<name>.md           agent-install, docker, developer, connector setup
/docs/reference/index.md          generated: the box-docs README "read it when" table
/docs/reference/<name>.md         generated: bbx-commands, procedures, triage, views, connectors, ...
/docs/reference/cards/index.md    generated: card-type catalogue (55 rows, split out for size)
/docs/reference/cards/<type>.md   generated: one per built-in card type
/docs/operating/<name>.md         running a box: secrets, model policy, security overview, health, scheduler
/docs/contracts/<name>.md         mobile contract, scan-upload contract, CSP
/<page>.md                        the human site pages' twins (unchanged)
```

`llms.txt` follows the llms.txt convention (H1, blockquote summary, H2
sections of `- [title](url): description` lines, an `## Optional` section).
It links orientation and install leaves directly (one hop) and links the
`reference/` and `cards/` indexes (two hops to a leaf). Estimated size
~4 KB; the card index ~8 KB. Every leaf carries a one-line header naming its
section and index so a model that lands on a leaf directly can climb.

No `llms-full.txt` in the first cut. The corpus is tens of thousands of
lines; a concatenation would truncate in most fetchers and is the flat dump
the framing rules out. Revisit only with evidence a fetcher needs it.

## Sources: three kinds, one manifest

| Kind | Source | How it gets in | Drift |
|---|---|---|---|
| Generated | engine doc set (`engineDocs()`) | site build runs `scripts/export-box-docs.ts`, writes the set | none: pure function of engine |
| Promoted | allowlisted files under `beebox/docs/` | listed in `site/docs-manifest.yaml` | content-hash rebuild; scrub gate |
| Authored | `site/cards/*.site-page.card` twins; a few new orientation pages | existing site pipeline | existing authorship rules |

**Generated.** A new export-only script, `beebox/scripts/export-box-docs.ts`,
prints the engine doc set (`engineDocs()` from `package-docs.ts`) as JSON on
stdout with no filesystem side effect. The site build shells out to it
(site/ stays free of beebox imports, as `site/CLAUDE.md` requires) and
rewrites the set into `dist/docs/reference/`. The README becomes
`reference/index.md`; the 55 `card-*.md` rows are split into
`reference/cards/index.md`. Cost: one tsx invocation per build.

Staleness contract: the generator's inputs are transitive (view, chat, and
python doc generators live outside `docs-gen/`; templates register by
side-effect import), so enumerating them in `site/sources.ts` would drift.
Instead the site build always runs the export, and the input manifest folds
in the export's own content fingerprint. The Cloudflare build is therefore
always current. The dev router decides whether to rebuild from the manifest
without running the export, so it can serve a reference set that lags an
engine edit until the next explicit `pnpm --dir site build` or any
`generateDocs` run refreshes `beebox/box-docs/.hash` (which the manifest
also folds in). Accepted as dev-only staleness; noted in `site/CLAUDE.md`.

**Promoted.** A single reviewable list, `site/docs-manifest.yaml`, one entry
per published doc: repo path, published path, section, one-line description
for the index. Adding a line *is* the vetting act, and `git log` on the
manifest is the record of who admitted what. The loader hard-codes the
admissible prefixes (`beebox/docs/*.md` flat, `beebox/docs/design/`,
`beebox/docs/architecture/`, root `README.md`); a plans, issues, research, or
private-issues path fails the build regardless of what the manifest says.
This mirrors the closed allowlist `site/nuggets.ts` already uses.

Site-side manifest rather than a `public: true` marker in each doc's
frontmatter: the question "what is exposed?" should have one answer in one
file, and a doc editor should not be able to publish by flipping a flag in a
file nobody reviews for publication.

**Authored.** Orientation is mostly promoted repo docs (glossary,
cards-as-markdown, box-layout, design/*) with at most two new pages: a
"what Bee Box is, in 300 words, for a model" page and a "how these docs are
organized" page. Human-site page twins stay where they are. New agent-facing
prose is agent-written and says so in its `authorship`; nothing here claims
the boxholder's voice.

## The scrub gate (build-time, fail-closed)

Every promoted and generated file passes through one scan before it is
written to `dist/`. A hit fails the build naming file and line:

- real home paths: `bin/path-leak-check.ts`'s `HOME_PATH` pattern and its
  `/Users/me` · `/Users/you` allowance, exported from that file (today it is
  a module-local const);
- `private-issues`, `~/src/boxes/`, `~/src/box-worktrees/`;
- the developer's gitignored `.commit-blocklist` patterns, when present.
  `bin/commit-blocklist-check.ts` scans staged additions only, so the site
  reuses its pattern-file parser, not the tool;
- relative links into an excluded root (see below).

The gate is mechanical. It catches paths and names, not a paragraph that was
written for us rather than for a stranger. The defense against that is the
prefix denylist: the material with that character (plans, issues, decisions)
is excluded by construction, and the flat `docs/` area is reference-shaped by
`docs/README.md`'s own taxonomy. The manifest line is where a human judged
the rest.

## Links between docs

Promoted docs link each other relatively (`../plans/foo.md`, `secrets.md`).
At build, each internal link is resolved:

- target is in the published set: rewrite to its public URL;
- target is under an excluded root (`plans/`, `implemented-plans/`,
  `unimplemented-plans/`, `reports/`, `issues/`, `research/`,
  `private-issues/`): the link is flattened to its text. Those files are
  readable on GitHub already, but the corpus must not lead a model into
  them; `security-overview.md` and `scheduler.md` both carry such links
  today, so this case is common, not hypothetical;
- target is any other tracked repo file (source, a held-back reference doc):
  rewrite to the GitHub blob URL on `main`;
- target does not exist: build failure.

This is a new pipeline, not reuse: the existing site link check compares
collected links against emitted HTML pages and rewrites `.md` to `.html`.
Agent docs are raw markdown with relative links, so `site/docs.ts` owns its
own resolver with parser-level tests for each of the four cases.

Images under `docs/architecture/images/` are copied alongside their pages
(they are tracked, small, fictional).

## The pasted prompt

Lives on the home card beside the install prompt, as a second
`{% agent-prompt %}` with id `learn-with-your-agent`:

```
Fetch https://beebox.run/llms.txt. It indexes Bee Box's documentation for
agents: an orientation, install guides, a generated reference (every bbx
command, every card type, connectors, procedures), and operating notes.
Fetch the pages you need before answering, tell me which page you drew on,
and say when something isn't covered rather than guessing. I'll ask you
questions about Bee Box.
```

Shared surface with the install prompt: both fetch from `beebox.run/docs/`
once it exists. The install prompt currently fetches
`raw.githubusercontent.com/.../agent-install.md`; repointing it to
`https://beebox.run/docs/install/agent-install.md` gives a stable URL that
survives a repo move and is the same file. That repoint belongs to the
[container-first](../../../issues/features/2026-09-06-container-install-is-the-primary-path.md)
work, which owns the install story; this plan only makes the URL exist.

## First-cut manifest (proposed; the boxholder edits)

- **orientation**: `glossary.md`, `cards-as-markdown.md`, `box-layout.md`,
  `connectors.md`, `triage.md`, `questions.md`, `landmarks.md`,
  `procedure-implementation.md`, the ten `design/` files, and from
  `architecture/` only `01-what-is-this.md` and `02-cards-and-memory.md`
  (its `CLAUDE.md` marks the rest as steering docs, not user-facing). The
  manifest lists files, never globs.
- **install**: `agent-install.md`, `docker-install.md`,
  `developer-install.md`, `google-setup.md`, `gmail-setup.md`,
  `google-drive.md`, `telegram-setup.md`, `calendar.md`, `adding-a-box.md`.
- **operating**: `secrets.md`, `model-policy.md`, `security-overview.md`,
  `health-checks.md`, `scheduler.md` (after its example loses the real box
  name), `migrations.md`, `assets.md`, `chat-schedules.md`.
- **contracts**: `mobile-contract.md`, `scan-upload-contract.md`,
  `content-security-policy.md`, `adding-schemas.md`, `card-validation.md`.
- **held back** (dev process or internal record, revisit later):
  `testing.md`, `tours.md`, `maintenance.md`, `server-operations.md`,
  `stack-decisions.md`, `security-report.md`, `prompt-*.md`,
  `chat-scroll-testing.md`, `composer-*.md`, `doc-graph.md`, `reports/`.

The two architecture chapters are human narrative with images; they are the
best "what is this" text we have and a model can filter them. **Decision for
the boxholder:** in or out of the first cut.

## Not in scope

- The box-specific agent guide (`.beebox/agent-guide.md`) needs a box to
  render against; a box-free rendering is a later track if the reference set
  turns out to miss what it says.
- Rendering agent docs as HTML pages for humans. The generator can do it
  cheaply, but presentation is the public-site workstream's; a single human
  "Documentation" page linking into `/docs/` comes after they settle the
  visual system.
- Search, versioning by release, or per-release snapshots.
- Any change to the human site's cards, navigation, or visual system.

## Coordination with public-site

Shared file: `site/build.ts` (one call into a new `site/docs.ts`),
`site/sources.ts` (manifest gains the generator inputs and the promoted
files), the `llms.txt` renderer (sections instead of one flat list), and the
home card (one added prompt block). Everything else is new files. Change to
the shared pieces is additive; public-site is told before it lands, and the
`llms.txt` renderer change is the one they may want to shape.

## Tracks

1. **Corpus module** — `site/docs.ts`: manifest loader with prefix denylist,
   scrub gate, link rewriting, generated-set import; tests for each refusal.
2. **Generator hookup** — build runs `build-box-docs`, splits the card index,
   `sources.ts` inputs; router auto-rebuild verified.
3. **Index** — `llms.txt` sections, leaf headers, `llms-full.txt` (if kept).
4. **Content** — first-cut manifest, the two orientation pages, the
   `scheduler.md` example fix, the learn prompt on the home card.
5. **Verification** — the acceptance test is the user's flow, not a link
   check: a model with URL fetch and no repo or workspace access is given
   the pasted prompt and ten questions a new user would ask; record which
   fetches it made and what it got wrong. Run against a preview URL with a
   non-Claude model, then once by the boxholder in a real ChatGPT session
   before the prompt is called good.

## Failure modes

- **Cloudflare build cannot run the generator** (missing native dep, tsx not
  on the path): fail the site build loudly rather than publish a corpus
  without the reference set. Verified locally first; the Site checks workflow
  runs the same command.
- **Manifest lists a file that later moves**: build fails on the missing
  source; `pnpm doc-check --fix` does not know the manifest, so add it to the
  fix's path table or accept the one-line manual fix.
- **A promoted doc grows a leak after admission**: mechanical scrub catches
  paths and names; anything else is the same risk `README.md` already
  carries.
- **Model fetches a leaf cold**: the leaf header names its index.

## Open questions for the boxholder

1. The two `docs/architecture/` chapters: in the first cut or held.
2. Held-back list above: anything that should be in (stack-decisions is the
   likeliest).
3. The learn prompt wording.
4. Links into excluded roots: flatten to text (proposed) or fail the build
   and edit the docs.

## Cross-model review (2026-09-12)

Codex reviewed the first draft. Adopted: no GitHub fallback for links into
excluded roots; explicit file list instead of `architecture/*.md`; export-only
generator script instead of shelling to the writer; fingerprint-based
staleness instead of enumerating transitive generator inputs; `HOME_PATH`
export and blocklist parser reuse spelled out; `llms-full.txt` cut; the
acceptance test made fetch-only. Nothing rejected.
