---
title: "Author public-site cards in a box and export them to the repository"
status: draft
workstream: public-site
issues:
  - ../../../issues/exploration/2026-08-19-site-authored-in-a-box.md
  - ../../../issues/features/2026-07-20-public-site.md
---
# Author public-site cards in a box and export them to the repository

When public-site content needs the Bee Box authoring environment, I want to
develop it in a private local box without putting drafts, source material, or
editorial conversation into the public repository, so the repository contains
only the reviewed public cards and a readable editorial history.

**Issues addressed:**

- `issues/exploration/2026-08-19-site-authored-in-a-box.md` — authoring the
  public site inside a box and exporting it to the static site.
- `issues/features/2026-07-20-public-site.md` — the repository remains the
  source for a static, precalculated site while the working process stays out
  of its history.

## Stated preferences this plan trades against

- **Repository content is canonical.** The existing public-site plan says the
  site is generated from repository content (`beebox/docs/plans/public-site.md:9-20`).
  The box is therefore a workbench and projection, not a second canonical
  content store.
- **The working process stays out of the public history.** The orientation
  map records “outcomes tracked in git, the working process not” and keeps box
  authoring/export open (`beebox/docs/plans/public-site-orientation.md:20-43`).
  The exporter copies selected card material, not chats, drafts, or the box's
  Git history.
- **Validate at boundaries.** Engineering principle 3 requires hand-editable
  files and other process boundaries to be validated once with loud failure
  (`beebox/docs/engineering-principles.md:37-47`). The export command validates
  the box projection before it writes repository files.
- **Never fail silently.** Engineering principle 4 requires failures to be
  visible and contextual (`beebox/docs/engineering-principles.md:49-62`).
  Private links, missing attachments, malformed cards, and unsafe paths fail
  with the source card named.
- **One way to do each thing.** The static site already has a strict card
  frontmatter contract and independent renderer (`site/card-authoring.md:28-76`).
  The exporter must invoke the same parameterized site build against a staged
  card root rather than inventing a second graph validator.
- **The maintainer's voice is protected.** The public-site direction allows AI
  structure but not undisclosed AI words (`beebox/docs/plans/public-site.md:14-18`,
  `site/card-authoring.md:128-132`). The exported card keeps the explicit
  people and AI contribution account.

## What already exists

- **The static source root is `site/cards/`.** The authoring guide calls
  `cards/` the source root and defines page, document, and attachment paths
  (`site/card-authoring.md:1-26`). Reuse that path as the export destination.
- **The site already has strict authorship metadata.** Page cards require
  `authorship`, with person-centered contributions and required AI categories;
  new AI categories are permitted inside `authorship.ai`
  (`site/card-authoring.md:28-71`). The box schema must produce this shape;
  the exporter must validate it, not translate it into a weaker shape.
- **The static build has no live application dependency.** The site copies only
  local assets and does not import app frontend code
  (`site/card-authoring.md:114-126`). Export produces ordinary checked-in card
  files so this boundary remains intact.
- **Bee Box supports box-local schemas.** Box schemas live under `src/schemas/`
  and use `cardSchema()` with YAML frontmatter and Markdown body
  (`beebox/docs/cards-as-markdown.md:22-24`, `beebox/docs/box-layout.md:240-250`).
  The authoring box currently has an empty `_config/schemas/` legacy directory; the
  new schema must use its `src/schemas/` location.
- **The box workbench spaces now exist.** The authoring box's `CLAUDE.md` defines
  `_publish/public-site/` as export staging and
  `_content/public-site-work/` as private drafts and source material. This
  plan turns that convention into a tested export operation.
- **The earlier issue already names the intended first experiment.** It calls
  for a page schema in a test box, a walkthrough authored as a card, and a
  crude export to `site/content/` (`issues/exploration/2026-08-19-site-authored-in-a-box.md:42-43`).
  The current site uses `site/cards/`, so this plan updates the destination to
  the shipped source root.

## Prior art (external)

No external prior art is needed for the first chunk. This is a repository-local
projection and export boundary using existing Git, Bee Box card files, and the
site's own strict parser. The relevant design precedent is internal: the
existing public-site card contract and the committed-artifact model in
`beebox/docs/plans/public-site.md:356-369`.

## Tracks / scope

### Track A — box-local public-site card schema and guidance

**What:** Add a `site-page` schema to the authoring box's `src/schemas/site-page.ts` and
make the box's generated instructions teach the public-site authoring shape.
The schema accepts the page body plus the fields already consumed by the site:
`title`, `summary`, `authorship`, `theme`, `stock`, `chrome`, `navigation`,
`kind`, `status`, `unlisted`, and ordered `next` destinations. The
`authorship.people` entries require `name`, `role`, and `contribution`.
`authorship.ai` requires `transcription`, `drafting`, and `editing`; each is
`none` or a description. Additional AI keys are accepted as descriptions.

**Why this needs to change:** The box must make the same card shape easy to
author that the static site already validates. Without a schema, the box agent
can create plausible but unexportable cards, and the current `_publish` space
is only a naming convention.

**Direction:** Use the current Bee Box frontmatter/body schema API and the
existing filename type `*.site-page.card`. Add a separate box-local
`*.site-doc.card` schema for attached public documents. It mirrors the site's
document fields, and export maps the suffix to the public `*.doc.card` suffix,
so public URLs remain stable without colliding with Bee Box's built-in lenient
`doc` schema. Do not add a custom view yet: the first version uses the static
site build as the faithful preview. Add schema instructions that point agents
to `_publish/public-site/` for selected cards and `_content/public-site-work/`
for private material. State explicitly that public-site links use site-root
addresses, not box-root addresses.

**Vocabulary lock-ins:** `site-page` and `site-doc` are the box card types;
`_publish/public-site/` is the export allowlist; `_content/public-site-work/`
is private work; `site-doc` exports as public `doc`; the authorship field names
and AI core categories match `site/card-authoring.md`.

**First implementation chunk:** Add the schema, update the box-local
authoring guidance, run `bbx init` for the authoring box to generate its rules/docs,
and author one minimal valid page card in the staging directory. Do not add
export code in this chunk.

### Track B — bootstrap the working projection

**What:** Bootstrap the current public card graph into
the authoring box's `_publish/public-site/` as a one-time, reviewed working projection.
Copy card files only, preserving relative card paths and card bytes. Do not
copy binary attachment files, `site/dist/`, test fixtures, private source
material, or the repository's Git history.

**Why this needs to change:** The box cannot author content it has never seen.
The first hand-copied projection establishes a reviewable starting point
without prematurely building a synchronization tool.

**Direction:** Copy the current `site/cards/` card files into the staging
directory as a deliberate bootstrap step, then commit that snapshot in the
authoring box's repository. If the repository changes while a card is being
developed, re-copy the current card before re-applying the intended edits.
There is no live import command in the first version.

**Vocabulary lock-ins:** the bootstrap is a manual repository-to-box snapshot;
it is not a synchronization operation.

**First implementation chunk:** Copy the current six card files into
the authoring box, including the `why-it-asks.site-aside.card` card, and convert
public document card suffixes to `site-doc` in the box projection. Record the
mapping in the workbench README. Do not copy binary attachments.

### Track C — export selected cards back to the repository

**What:** Add an explicit box-to-repository export operation. It reads only
`<box>/_publish/public-site/`, maps `*.site-doc.card` back to public
`*.doc.card`, validates the selected graph through the site's existing build,
and writes the selected card files into `site/cards/`. It emits a normal
repository diff for human review; it does not commit, push, deploy, or read the
box's chat history.

**Why this needs to change:** The box is useful for authoring only if its
selected results can become repository content without pulling along private
drafts or editorial conversation.

**Direction:** First refactor the site build into a parameterized
`buildSite({ cardsDir, distDir, base })` core. The existing site graph checks
run against a temporary copy of the staged card root; exporter-specific code
only handles box-root path safety, suffix mapping, and dry-run/apply reporting.
The public command is `pnpm --dir site box-export --box <path>`. Dry-run is the
default and reports additions, updates, invalid refs, and cards that would be
removed. `--apply` is required to write. The first version never deletes
repository cards automatically. The exporter rejects symlinks, absolute paths,
`..` escapes, unsupported card suffixes, and links to cards outside the staged
graph. It preserves the staging card's frontmatter and body rather than
rewriting authorship prose.

**Vocabulary lock-ins:** `box-export` means box to repository;
`_publish/public-site/` is the complete selected graph; `site-doc` maps to
public `doc`; `--apply` is the only write mode; box Git trailers are not
imported into repository history. The public card's current `authorship`
account is the durable public record, while meaningful box trailers remain
editorial-workbench provenance.

**First implementation chunk:** Export the bootstrapped walkthrough and
attached confidence card through a fixture box, with dry-run output, the
temporary-build validation, suffix mapping, and an apply mode that produces
only the expected `site/cards/` diff. No automatic commit or deployment.

### Track D — round-trip content workflow and agent-facing documentation

**What:** Document the bootstrap/edit/export loop in the public-site authoring
guide and the authoring box's `CLAUDE.md`. Add a short export report that names the box,
source staging root, destination root, cards changed, and validation failures.

**Why this needs to change:** The workflow spans two repositories and two
different meanings of “content.” Without a visible report and agent-facing
rules, an agent can publish a draft, edit the wrong copy, or assume that
placing a card in staging shipped it.

**Direction:** Keep the report deterministic and plain text. Record no chat
transcript or private source excerpts. The box's CLAUDE guidance remains the
authoritative instruction for where work belongs; the repository guide is the
authoritative instruction for how the site validates and renders the result.

**Vocabulary lock-ins:** “workbench” means the authoring box; “staging” means
`_publish/public-site/`; “private work” means `_content/public-site-work/`;
“export” means a reviewed write into repository `site/cards/`.

**First implementation chunk:** Add the round-trip section and report shape.
The documentation must distinguish “selected for export” from “already
published.”

## Could this be simpler?

The simplest version is a documented manual copy of selected `.card` files from
the authoring box's `_publish/public-site/` into `site/cards/`, followed by the existing
site build. That would prove the content shape, but it fails on the actual
boundary: it can copy a private link, omit an attachment, overwrite a reviewed
card, or pull in the box's process accidentally. Engineering principles 3, 4,
and 8 require one validated boundary rather than a second informal parser and
an agent convention. The fuller plan buys deterministic allowlisting, dry-run
review, path safety, and a reproducible import/export loop without adding live
sync infrastructure.

## Subplans

None. The first implementation has one settled vocabulary and no independent
research question. If box-local page rendering or a publication manifest later
becomes a separate design problem, split it into a subplan before expanding
Track A or C.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A private draft is placed outside staging but is copied anyway | planned: export fixture with private draft outside staging | exporter reads only `_publish/public-site/` | clear: report names the selected root |
| A private card is linked from a staged card | planned: invalid external-ref fixture | exporter fails with source card and target path | clear |
| A staged path escapes the box root or uses a symlink | planned: traversal/symlink fixtures | exporter rejects the path | clear |
| Malformed authorship or AI metadata reaches the repository | planned: schema fixtures | existing site parser rejects it with card context | clear |
| `--apply` overwrites a repository edit | planned: differing-destination fixture | dry-run is default; report shows the replacement before explicit apply | clear |
| An empty or incomplete staging directory removes public cards | planned: missing-destination fixture | v1 never deletes automatically | clear |
| A card move silently changes its public URL | planned: path-change fixture | export reports add/update/delete candidates separately; no implicit move | clear |
| The box path is absent or not a box | planned: CLI input fixture | command fails before reading or writing | clear |
| A box agent assumes staging means shipped | planned: knowledge audit | CLAUDE guidance and export report say publication requires repository review | clear |

No critical gap is accepted. The exporter must not write any destination file
until discovery, path checks, card validation, and attachment validation pass.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED:** the box-local `site-page` and
  `site-doc` schemas supply the card types and required authorship fields; the
  exporter applies the site's stricter full-card validation through the build.
- **Stale ref — ADDRESSED:** refs to cards outside the staged graph fail during
  export rather than becoming broken public links.
- **Two agents touching the same card — ADDRESSED:** the box's Git state is
  the working coordination boundary; export reads one selected snapshot and
  leaves the repository diff for review.
- **Hand-edit drift — ADDRESSED:** `bbx validate` handles the box schemas and
  the site build handles the publication graph; both name the card.
- **Fabricated free-form value — ADDRESSED:** person contributions and AI
  category descriptions remain explicit authored assertions; unknown AI
  categories are allowed but cannot omit the required core declarations.
- **Validation error UX — ADDRESSED:** dry-run and failed export reports name
  the operation, box path, card path, and rule without a stack trace.
- **Partial migration / transition state — ADDRESSED:** the bootstrap creates a
  complete current card snapshot; export does not delete missing destination
  cards until a later explicit deletion decision.

## NOT in scope

- **Live synchronization** — the first version uses a manual bootstrap and
  explicit export, which keeps the box's private work from becoming an
  implicit publication channel.
- **Automatic commits, pushes, or deployment** — the repository diff must stay
  a human-reviewed Git change.
- **Copying box Git history or chat transcripts** — only selected card files,
  attachments, and current public authorship accounts cross the boundary.
- **Parsing editorial trailers into public authorship** — trailers remain a
  box-side experiment until real work shows that aggregation is useful.
- **A general CMS or custom page view** — use the existing Bee Box card viewer
  and the site's existing renderer first.
- **Automatic publication manifests or public access control** — staging-root
  allowlisting is sufficient for this first export; a manifest can follow if
  one staging directory proves too coarse.
- **Binary attachments** — the current site build does not publish arbitrary
  files inside card attachment directories. Add this only as a separate site
  feature before adding it to the box export.
- **New URL, tab, or contextual deep-link policy** — these remain open in the
  paper-system issue and are independent of content transport.
- **Moving the existing story-extraction pipeline into the box** — this plan
  only provides the card transport boundary.

## Open design questions

- **Should `site-page` eventually replace the site's file-suffix convention?**
  Lean: no for now. Preserve the existing public `*.site-page.card` and
  `*.doc.card` paths; use only the box-side `*.site-doc.card` mapping so URLs
  and the static renderer remain stable.
- **Should the staging directory later become a manifest?** Lean: only when
  one directory cannot express the publication set. The current directory
  allowlist is easier for the first authoring loop to understand.
- **Should box trailers generate the public people-centered account?** Lean:
  defer. First make explicit frontmatter accounts work in the box and survive
  export; then inspect real trailer usage before adding aggregation.
- **Should the box render a faithful visual preview?** Lean: not in the first
  chunk. Use the static site build against the exported cards until the actual
  authoring friction justifies a box-side view.
- **How should public deletions work?** Lean: add an explicit tombstone or
  deletion command after the first export. Do not infer deletion from absence
  during the bootstrap.

## Knowledge audits

None for the first chunk. The box-specific guidance lives in the authoring box's
CLAUDE.md and is validated through the box's normal schema/document generation;
adding private workbench vocabulary to the repository-wide audit suite would
make the audit less portable. If the workflow becomes a durable box feature,
that feature's plan should add a targeted audit.

## What will hold this after it ships

- `site/box-export.test.ts` covers discovery, allowlisting, path safety,
  `site-doc` suffix mapping, strict authorship validation, temporary-build
  validation, dry-run output, apply output, and no-delete behavior using a
  temporary fixture box.
- Existing `site` build tests remain the final publication check. The export
  tests should call the same parser/validator used by the build rather than
  snapshotting a second card interpretation.
- A box-side validation run covers the `site-page` and `site-doc` schemas and
  generated agent guidance; it does not replace file-level export tests.
- A manual router pass is required for the first real exported walkthrough,
  because static HTML can pass validation while card backs, attachments, or
  in-page transitions are visually wrong.

## Implementation order

1. **A1 — box card contract:** add the authoring box's `src/schemas/site-page.ts` and
   `site-doc.ts`, generated guidance, and one valid staged page card; commit the
   box-side changes in the authoring box's repository.
2. **B1 — bootstrap:** copy the current public card files into the staging
   directory, map public document cards to `site-doc`, and commit the snapshot
   in the authoring box.
3. **C1 — reusable build:** parameterize the site build around a card root and
   temporary output directory without changing its deployed behavior.
4. **D1 — export:** add `box-export` with dry-run, strict temporary-build
   validation, path checks, suffix mapping, and apply-without-delete behavior.
5. **E1 — round trip:** export the walkthrough fixture, update the authoring
   docs and report, and perform the first browser review.
6. **F1 — real content:** use the resulting workflow to author the next public
   cards; only then decide whether trailer aggregation or a publication
   manifest deserves a separate plan.

## Rollout shape

The box-side schemas and guidance land first in the authoring box and are validated
there. The repository build is parameterized without changing its deployed
behavior. The bootstrap creates a complete card-only staging snapshot before
any export is attempted. The first export is reviewed as an ordinary
`site/cards/` Git diff, followed by the existing site build, typecheck, lint,
tests, and a router/browser pass.

Done means:

- A card can be authored and validated in the authoring box with the required
  authorship and AI declarations.
- Private drafts and conversations remain outside the export root.
- Dry-run export identifies the exact public diff without writing it.
- Apply export writes only validated selected cards and attachments.
- No automatic deletion, commit, push, or deployment occurs.
- The exported walkthrough builds and renders from the repository alone.
