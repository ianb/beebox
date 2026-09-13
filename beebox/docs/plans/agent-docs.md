---
title: "Agent documentation"
status: active
workstream: agent-docs
issues:
  - ../../../issues/features/2026-09-12-agent-documentation.md
---
# Agent documentation

A public, browsable, plain-markdown corpus about Bee Box, read by a general
chatbot on behalf of a person who is **not using Bee Box and is deciding
whether to**. They paste one short prompt into ChatGPT (or any model that can
fetch URLs); the model fetches `https://beebox.run/llms.txt` and from there
whatever it needs to answer their questions. The headline is evaluation: what
the system is like, what it is for, what it offers, what it asks of you. The
internals are there too, deep enough down, and at the bottom the corpus
bridges into the reference a box agent uses. This is not the human site
([public-site.md](public-site.md)); it is the machine layer that site's
principles already call for ("two audiences, visibly separated").

Design constraints, from the boxholder's framing (2026-09-12):

- **The reader is a model that knows nothing.** `bbx` means nothing to it.
  Every page stands on its own vocabulary or links the page that defines it.
- **The person behind the model is an evaluator**, not an operator. The spine
  answers an evaluator's questions; operator material sits below it.
- **Structure can be explicit and mechanical.** This is only for LLMs, so
  indexes are file listings with one-line descriptions, and filenames carry
  the structure: numbered where order matters, descriptive everywhere.
- **Completeness beats curation.** The site is spare on purpose; this is not.
- **Hierarchy is a requirement.** Not a flat dump; not a tree so deep the
  model gives up. Target: any leaf within two hops of `llms.txt`.
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

## Who is asking (personas, proposed 2026-09-12)

Each is a person with some agent in hand, from free ChatGPT to Claude Code
pointed at the URL. The agent fetches; the person decides.

- **The Claude Code regular.** Runs Claude Code or Codex daily for code and
  has heard "personal assistant built on Claude Code". Asks: what does this
  add over my own CLAUDE.md and scripts, is it a framework or a product, how
  opinionated is it, can I read the code. Reaches the internals by their
  third question.
- **The person who wants their life organized.** Light or no development
  background, probably on free ChatGPT. Wants email read, lists kept, things
  remembered. Asks: how hard is it to set up, what does it cost a month, is
  my email safe, does it work on my phone. Two or three fetches per answer at
  most, zero tolerance for jargon. The requirements (a machine that stays on,
  an agent subscription) may end the evaluation, and the docs should let that
  happen early and honestly.
- **The self-hoster.** Runs a homelab, already tried one or two agent
  frameworks (OpenClaw, Hermes, Letta, Khoj). Asks: what leaves the machine,
  which models must I use and can I bring my own, Docker or not, license,
  bus factor, how it compares to what I have.
- **The evaluator for a household.** Technical enough to run it, assessing
  for a partner or family. Asks: can several people share one box, how does
  a non-technical person interact (Telegram, chat), what admin burden lands
  on me. Shared boxes are a design ruling (`design/identity.md`); what
  multi-user use actually looks like today is checked before this page
  claims it.
- **The builder.** Makes agent systems and reads Bee Box as a design. Asks
  why, not whether: the rationale, the architecture, the decisions, what to
  borrow. Design and architecture are for them, off to the side.

What follows from the personas:

- `llms.txt` itself answers questions 1, 2, and 6 in ~300 words before the
  listing, so a one-fetch reader (free ChatGPT) gets the dealbreakers from
  the entry point alone.
- Question 6 states model dependency plainly: Claude Code or Codex today,
  what each supports, no local models.
- Question 2 includes the household case; question 4 gets a sharing page
  if the checked facts support one.
- Comparisons get their own directory (below).

## The evaluator's questions (the model the corpus answers)

An interested potential user, in roughly the order they ask:

1. **What is it, in a paragraph?** Category, one-sentence mechanism, what
   you give it and what you get back.
2. **What would I use it for?** (added 2026-09-12) Several worked-out uses,
   each with its own page under `uses/`, and an instruction to the reading
   agent to open the ones that fit what it knows about the person.
3. **Why not just use a chatbot?** (added 2026-09-12) An honest appraisal
   against the chat apps and against Claude Code or Codex alone: what Bee
   Box does today that they do not, and what they do better.
4. **Is it for me?** Who it fits (already uses Claude Code or Codex, lives in
   files and git, wants an assistant that accumulates and that they own) and
   who it does not (wants an app, phone-only, wants a chat product).
5. **What does using it look like?** A day with it: a morning briefing, email
   triage, a voice memo becoming a todo, a clipping becoming notes, the
   questions it asks, the chat.
6. **What can it do?** The capability list: connectors (Gmail, Drive,
   Calendar, Telegram), chat and voice, triage, procedures, schedules, views
   and dashboards, courses, recipes, publishing, phone capture. Concretely:
   the kinds of things it holds (the card types).
7. **How does it work?** Box is a directory; cards are markdown with
   frontmatter; git is history; engine and box are separate; the agent runs
   with real capabilities; the wakeup cycle; the CLI as the interface.
8. **What does it require and cost?** A machine that stays on (local or a
   VPS), a Claude Code or Codex subscription or API key, Docker; model usage
   is the running cost; time to set up.
9. **How do I try it?** The install paths, container first; the agent-driven
   install; time to first value.
10. **Is my data safe?** Where data lives, what leaves the machine, what the
   agent may do and when it asks first, secrets handling, the security
   overview.
11. **How mature is it, and who is behind it?** Early, source-available, one
   maintainer, changing fast; license; the community server; how updates
   work.
12. **How does it compare?** Against the chat-first agent products and the
    memory frameworks: cards-first vs chat-first, rules enforced in code vs
    doctrine in prompts. Answered with dated, caveated comparison pages.
13. **Can I make it mine?** Rules, guides, personality, box-local card types,
    views, procedures, Python tools, skills.
14. **Why is it built this way?** The design rationale and the narrative
    chapters. Off to the side, still important.
15. **Show me the internals.** The generated reference (every command, every
    card type, connectors, procedures), the contracts, the on-disk layout.
    This is where the corpus becomes the box agent's documentation.

Questions 1 to 13 are the spine: one numbered file each, short, authored,
each linking down into the directory that holds the depth. Questions 14 and
15 are directories the spine points at.

## The hierarchy

Filenames are the structure. Every directory has an `index.md` that is a
file listing with one line per file, and `llms.txt` is the same thing for
the root. Numbers order the spine; everything else is named for what it
answers.

```
/llms.txt                              root index: the spine, then the directories
/docs/01-what-bee-box-is.md            question 1
/docs/04-who-it-is-for.md              question 2
/docs/05-a-day-with-the-box.md         question 3
/docs/06-what-it-can-do.md             question 4; links capabilities/ and reference/cards/
/docs/07-how-it-works.md               question 5; links concepts/, architecture/, design/
/docs/08-what-it-requires.md           question 6
/docs/09-trying-it.md                  question 7; links install/
/docs/10-your-data-and-safety.md       question 8; links security/
/docs/11-status-and-maturity.md        question 9
/docs/12-compared-to-alternatives.md   question 10
/docs/13-making-it-yours.md            question 11
/docs/compared/<system>.md             one page per compared system, each opening with a caveat block
/docs/capabilities/<name>.md           one page per capability: gmail, calendar, drive, telegram,
                                       chat, voice, triage, procedures, schedules, views, courses,
                                       recipes, publishing, phone-capture, questions
/docs/concepts/<name>.md               glossary, cards, box, engine-and-box, wakeup, landmarks, trust
/docs/install/<name>.md                docker, developer, agent-install, google, gmail, telegram
/docs/security/<name>.md               overview, secrets, what-the-agent-can-do
/docs/architecture/<nn>-<name>.md      the narrative chapters (two today)
/docs/design/<name>.md                 the ten why-docs
/docs/reference/index.md               generated: when to read each doc
/docs/reference/<name>.md              generated: bbx-commands, procedures, triage, views, connectors, ...
/docs/reference/cards/index.md         generated: every card type, one line each
/docs/reference/cards/<type>.md        generated: one per built-in card type
/docs/contracts/<name>.md              mobile, scan-upload, csp, box-layout
/<page>.md                             the human site pages' twins (unchanged)
```

`llms.txt` lists the thirteen spine files with their questions, then each
directory with its one-line purpose and its `index.md`. Estimated ~3 KB. A
directory `index.md` is generated from the manifest, never hand-written.
Every leaf opens with one line naming its directory and index so a model that
lands cold can climb.

No `llms-full.txt`. The corpus is tens of thousands of lines; a concatenation
would truncate in most fetchers and is the flat dump the framing rules out.

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
`{% agent-prompt %}` with id `learn-with-your-agent`. It assumes the model
knows nothing and says only what it must:

```
Read https://beebox.run/llms.txt and follow its links as needed. I'm
deciding whether to use Bee Box; answer my questions from those pages.
```

Everything else (what the sections are, cite the page, say when something is
not covered) belongs in `llms.txt`'s opening lines, where every fetch reads
it, rather than in the prompt a person has to paste.

Shared surface with the install prompt: both fetch from `beebox.run/docs/`
once it exists. Repointing the install prompt from `raw.githubusercontent.com`
to `https://beebox.run/docs/install/agent-install.md` belongs to the
[container-first](../../../issues/features/2026-09-06-container-install-is-the-primary-path.md)
work; this plan only makes the URL exist.

## Comparisons

`docs/12-compared-to-alternatives.md` summarizes; `docs/compared/<system>.md`
holds one page per system (OpenClaw, Hermes, Letta, Khoj, Goose, agent-zero,
nanobot, PAI, gstack are what `research/` covers today). Each page is authored
from the internal research, never a copy of it, and opens with a caveat block
the build generates from the manifest entry rather than trusting prose:

```
Compared: 2026-07-14 (OpenClaw v0.9, Bee Box at commit …)
Looked for: memory model, channels, scheduling, security posture, skills
Not looked for: pricing, hosted offerings, community size
Since then: both projects have changed; treat as a snapshot
```

`research/` stays excluded from the corpus; the compared pages cite it by
name only. A comparison older than a set age (proposed: six months) gets a
build-time "stale" line prepended rather than being dropped.

## First-cut content (proposed; the boxholder edits)

**Spine (authored, new, thirteen short files).** Drafted from sources that
already say these things: root `README.md`, `agent-install.md`'s "What
you're installing", `design/identity.md`, `security-overview.md`, the
soft-launch posture decision, the walkthrough card. Question 10 draws on the
`research/` syntheses without publishing them. Agent-drafted, labeled as
such in the manifest; not the boxholder's voice.

**Capabilities (authored short pages, one per capability).** Each says what
it does for the person, what it needs (a connector credential, a phone),
and links its concept and reference pages. Source: `beebox/user-stories/`'s
verified capability catalog (649 confirmed statements, 2026-08-21), which is
too raw and too stale-flagged to publish itself but is the checked substrate
to write from.

**Promoted (repo docs, listed by file).**
- concepts: `glossary.md`, `cards-as-markdown.md`, `connectors.md`,
  `triage.md`, `questions.md`, `landmarks.md`, `procedure-implementation.md`,
  `model-policy.md`, `chat-schedules.md`.
- install: `agent-install.md`, `docker-install.md`, `developer-install.md`,
  `google-setup.md`, `gmail-setup.md`, `google-drive.md`,
  `telegram-setup.md`, `calendar.md`.
- security: `security-overview.md`, `secrets.md`.
- architecture: `01-what-is-this.md`, `02-cards-and-memory.md` only (the
  directory's `CLAUDE.md` marks the rest as steering docs).
- design: the ten files.
- contracts: `box-layout.md`, `mobile-contract.md`, `scan-upload-contract.md`,
  `content-security-policy.md`, `adding-schemas.md`, `card-validation.md`,
  `migrations.md`, `scheduler.md` (after its example loses the real box
  name), `health-checks.md`, `assets.md`, `adding-a-box.md`.
- held back (dev process or internal record): `testing.md`, `tours.md`,
  `maintenance.md`, `server-operations.md`, `stack-decisions.md`,
  `security-report.md`, `prompt-*.md`, `chat-scroll-testing.md`,
  `composer-*.md`, `doc-graph.md`, `reports/`.

**Generated.** The engine doc set, as `reference/`.

## The contributor entry point (added 2026-09-12)

The builder persona gets a second entry, `beebox.run/llms-dev.txt`: a
preamble (`site/docs/dev/README.md`: repo layout, running from source,
tests, how a change lands), a `## Start here` list in reading order, then
every doc under `docs/dev/`, then the directories a contributor also needs.
`llms.txt` links it under `## Contributing`. The dev set is the formerly
held-back process docs plus the engine's own agent instruction files
(`beebox/CLAUDE.md`, `code-style.md`, `frontend.md`), which are the most
useful contributor pages of all. Anything authored for contributors that a
repo agent could also use lives in the repo and is promoted, not authored on
the site: the contributing page is the root `CONTRIBUTING.md`. Excluded
roots are unchanged; `stack-decisions.md` was frozen as a dated report
rather than admitted. `doc-check` now skips `site/docs/`, whose links are
published-relative.

Prompt for this entry:

```
Read https://beebox.run/llms-dev.txt and follow its links as needed. I'm
going to work on the Bee Box codebase; answer my questions from those pages.
```

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
4. **Content** — the thirteen spine files, the capability pages, the
   promoted list, the `scheduler.md` example fix, the learn prompt on the
   home card. The spine is written last, after the directories exist, so
   every link in it resolves.
5. **Verification** — the acceptance test is the user's flow, not a link
   check: a model with URL fetch and no repo or workspace access is given
   the pasted prompt and the thirteen evaluator questions above; record which
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

1. The personas and the evaluator questions: missing or wrongly ordered.
2. Comparisons: the caveat block fields, and the stale age.
3. Held-back list: anything to admit (stack-decisions is the likeliest).
4. Links into excluded roots: flatten to text (proposed) or fail the build
   and edit the docs.

## Cross-model review (2026-09-12)

Codex reviewed the first draft (before the evaluator reframing). Adopted: no GitHub fallback for links into
excluded roots; explicit file list instead of `architecture/*.md`; export-only
generator script instead of shelling to the writer; fingerprint-based
staleness instead of enumerating transitive generator inputs; `HOME_PATH`
export and blocklist parser reuse spelled out; `llms-full.txt` cut; the
acceptance test made fetch-only. Nothing rejected.

Round 2 (the implementation, 2026-09-12): five findings. Adopted: manifest
source and publish paths are normalized and refuse traversal before the
prefix check. Rejected with reasons: `hearth` is the fictional roster slug
from `example-names.md`, not a real box; bare (non-link) mentions of
`plans/…` paths in promoted prose and GitHub links into `.claude/` are
references to files already public in the repo and are not navigable into
the corpus, so they stay; the generated reference is the box agent's
material by design (question 13 is where the corpus bridges into it).
Residual accepted: internal path names appear as text in some promoted docs.

Fetch-only acceptance run (Codex with `curl` only, no repo access, served
build): all thirteen evaluator questions answered from the pages in 19
fetches, three honestly reported as not covered (monthly cost, maintainer
name, OpenClaw pricing). Two flagged contradictions fixed (the OpenClaw page's
"no threat model" claim now dated; the trying-it page says the Docker guide
covers only the Claude login). One remains for public-site: the home card
still says install guides live "in the repository for now".

Round 3 (the use-case and chatbot-appraisal pages, 2026-09-12): eight
findings, all adopted as small text edits: "built for and exercised"
softened; routing cues added to the reading-agent instruction on 02; the
teaching page no longer claims chat apps forget; Telegram is text-only, so
the household page photographs from the capture page; the clipping and
recipe pages qualify the snapshot and substitution claims; "a phone app" is
"an iPhone app"; the card filename example is now a parenthetical. A
non-programmer fetch-only run (household persona, four questions) chose the
fitting use pages, translated the jargon it met, and stated the sharing
limits correctly. A jargon pass removed framework and format names from the
spine, uses, capabilities, and compared pages.

Later the same day: a `capabilities/web-interface.md` page and a "What you
see" section on the first page and preamble, after a "what is it" answer
described only files and an agent; each use page gained "What makes it
possible" (the distinctive features it leans on, with the design rationale
where a design doc gives one), and the uses overview gained the reverse
index, feature to uses, so reading backwards shows why each feature exists.
`bbx` is named only on the how-it-works page, as the agent's own tool.

Three more capability pages at the boxholder's prompting: `shape-it-later`
(put things in before deciding their structure; the honest finding is that
an unknown header key is dropped on load and flagged, so the room for extra
information is the card body), `provenance` (the quote and source tags and what they carry; speaker
attribution is an agent convention that is used routinely), and
a specific `voice` page (spoken controls, narration mode, audio cards,
capture sessions mixing photos and speech, agent-chosen delivery, earcons,
on-device recognition, the named vendors). Wired into the first page, the
chatbot appraisal, the capability list, the use pages, and the reverse index.

`concepts/enriched-markdown.md` (authored): the boxholder's framing that
cards are markdown enriched in two specific places, a header each kind of
card extends and a body with a baseline of cross-cutting marks, quote,
source, and todo, that the whole system agrees on; linked from the first
page, how-it-works, provenance, and the reverse index.

## Fetchability (2026-09-12, after the boxholder's ChatGPT trial)

A chat agent given `llms.txt` invented URLs instead of following links. Three
causes found on the deployed host and fixed in the build: links were
site-relative or page-relative, and chat fetchers do not resolve them (every
link in the corpus is now absolute, `https://beebox.run/...` on the
canonical build, `http://localhost:3210/...` on the router); every `.md` was
served as `text/markdown`, which ChatGPT and Gemini fetchers report as empty
(a `_headers` file serves the docs tree, both entry files, and the page
twins as `text/plain`); and unknown paths returned the home page with a 200
(a `404.html` now makes a guessed URL a real miss; a `robots.txt` allows
all). After the deploy the boxholder tried a chat agent again: absolute links
helped but the agent still "did dumb stuff" with the markdown corpus. The
corpus therefore renders to spartan HTML (each page beside its markdown
twin), and the front page is itself a rendered markdown file carrying a
deep index of every page except the children of `dev/` and `install/`,
whose own entry pages (`llms-dev.txt`, `llms-install.txt`) carry full
indexes of their children. `llms.txt` returns HTML; the `.md` twins stay
plain text. (Two more causes surfaced along the way: main had not been
pushed for two hours, and the Cloudflare build of main failed on a
scrub-gate hit nobody saw locally. Finish now runs the canonical site build
before a merge and the post-merge hook says when main is ahead of origin.) Also added: `capabilities/integrity.md` (links parsed and
checked, references rewritten on a move, validation at several layers).

