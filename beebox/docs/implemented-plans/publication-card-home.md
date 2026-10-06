---
title: "The publication card is the publication"
status: implemented
workstream: publication-home
issues:
  - ../../../issues/closed/decisions/2026-10-02-publication-source-and-card-split.md
---
# The publication card is the publication

When I look for a published site in my box, I want one card that is the site: its request settings, its notes, its files beside it, and its review controls. Today the files are in `src/publications/<name>/`, the settings are in `publication.json`, and a separate pointer card named by a random id holds the controls. This plan joins them and removes everything the old shape left.

**Issues addressed:** `issues/decisions/2026-10-02-publication-source-and-card-split.md`. Searched the queue for "publication" and "publications page": no other open issue covers the source layout, the card, the Publications page, or `bbx pub`. `issues/code-quality/2026-07-31-pub-worker-preauth-oracle-and-log-flood.md` is about the Worker and is not addressed.

## Smallest fix and budget

The smallest fix keeps both locations, names the pointer card by site name, and adds a `source` field to it. It leaves two places for one thing, so the boxholder rejected it (2026-10-06: "I think I like A").

The chosen design has six tracks: card schema, prepare-by-card, read access to published files, surface removal, box guidance and docs, and box migration.

**BIG CHANGE.** Estimate, additions plus deletions:

| Part | Lines |
|---|---|
| Source (schema, prepare lookup, routes, CLI, lint, frontend, Admin list, `.gitignore`, layout) | 900 |
| Migration script | 300 |
| Tests (doctests rewritten or new, frontend doctests) | 900 |
| Authored docs, guide ledger, knowledge audits | 700 |

The size comes from the sweep. `beebox/docs/box/publishing.md` is 679 lines and describes the old shape in five sections. `test/publish/prepare.doctest.md` has 35 references to the old shape. The boxholder asked for "nothing superfluous left", so the sweep is the task. Generated output (`box-docs/card-publication.md`, doc graph, template hashes) is not counted.

## Stated preferences this plan trades against

- **Consolidate over blast-radius fear** (`beebox/docs/engineering-principles.md`, principle 8, quoted in the earlier plan as "Competing idioms are drift generators"). The plan removes the second location and the compatibility page even though that changes the CLI, the route input, and the box docs.
- **Server-owned authority stays out of box-editable files.** The handoff states this is not negotiable. The card holds a request only. Approval, audience, host, and status stay in R2 and the machine secret store.
- **Minimize invented concepts.** The plan reuses the attach scope (`src/shared/attach-path.ts:15`: `export const ATTACH_SUFFIX = ".attach";`), the one existing cross-file lint pattern, and search by card type. It adds no list view, no card-as-directory convention, and no new store.
- **Strict by default.** `connection` and `tier` are required card fields. The cost is that the migration must handle pointer cards that have no source (see Track F).
- **Stop over-engineering rare failures.** Rare migration cases (two alias cards, a pointer card with no source) get one deterministic rule each, with a printed warning, and no recovery UI.

## What already exists

- **Definition schema.** `src/publish/prepare/definition.ts:45`: `export const publicationDefinitionSchema = z.discriminatedUnion("tier", [`. Reuse the per-tier rules. Remove the file reader (`readPublicationDefinition`, `:82`) and the fixed path (`publicationSourcePath`, `:75`).
- **Card schema.** `src/schemas/publication.ts:8` defines `publication` with `pubId` and `body`. Extend it.
- **Cross-field card validation.** `CardSchemaConfig.superRefine` (`src/cards/schema.ts:260`): "enforced by `frontmatterSchema.safeParse` itself, so a card that violates it fails to LOAD". Used by `src/schemas/question.ts:135`. Reuse.
- **Attach scope.** `attachDirFor` (`src/shared/attach-path.ts:40-41`) returns "the same directory as the card, with name `<basename>.attach`". The type segment is dropped: `Foo.publication.card` owns `Foo.attach/`. Subdirectories are supported (`:58-59`).
- **Move.** `src/core/commands/move/operations.ts:175-177`: "rename the `.card` file and its sibling `<basename>.attach/` directory". Reuse unchanged. No web UI move action exists.
- **Card enumeration.** `listBoxCardFiles` (`src/core/list-cards.ts:15`) globs `**/*.card`. Callers filter by suffix. No find-by-type function exists; the plan adds none beyond one filtered call.
- **Cross-file lint.** One rule exists: `lintDuplicateChatSession` (`src/core/card-lint/chat-duplicates.ts:43`), registered inline at `src/core/card-lint/core.ts:313-314`. Follow that shape for duplicate `pubId`.
- **Prepare.** `prepareManagedPublication` (`src/publish/managed-publications/core.ts:213`) runs local prepare, ensures the pointer card, reserves the binding, uploads, and writes the candidate. The candidate stores `name: args.name`. Reuse everything after local prepare.
- **File collection.** `collectPublicationFiles` (`src/publish/prepare/files.ts:204`) takes a root directory. It rejects symlinks (`:160`) and forbids `node_modules`, `package.json`, `notes.md` and similar names (`:23-27`). Reuse unchanged.
- **Authority tiers.** `src/webapp/trpc/routers/publications.ts:34` admits `user` and `agent`. `:42` admits only a signed-in user: "Agent, device, and open contexts fail closed." Reuse both.
- **Binding store.** `reserveCloudflarePublishBinding` (`src/core/secrets/cloudflare-publish.ts:289`) rejects a `pubId` bound to another box. `listCloudflarePublishBindings` (`:325`) lists per box. No unbind function exists.
- **Review UI.** `src/frontend/src/renderers/publication.tsx` reads `pubId` from frontmatter and mounts `PublicationApprovalView`, which finds its row in `publications.list`. Reuse.
- **Box `.gitignore`.** `writeBoxGitignore` (`src/core/box/structure/core.ts:245`) regenerates the file from one template string. `node_modules/` is already ignored at every depth.
- **Annexed assets are ordinary files.** `docs/plans/asset-annex.md:117`: "Working-tree files are ordinary files, not symlinks." Prepare's symlink rejection does not affect site images in an attach scope.
- **Guidance retirement precedent.** `src/scripts/migrate/retire-process-pages/run.ts:18-24` deletes a file whose hash matches a shipped version and parks any other copy under `_config/_template-updates/`. Reuse for `src/publications/CLAUDE.md`.
- **Migration model.** `test/scripts/migrate/filename-attach-scope.doctest.md` moves files and rewrites cards. Scripts receive `boxRoot` and use plain `fs`.

Searches that found nothing: no generic helper for the server to set one card field; no type-index page in the web UI; no code path that deletes a retired guidance file; no migration that moves a directory out of `src/`.

## Prior art (external)

No decision depends on an external premise. Cloudflare behavior, the Worker, and the R2 key layout do not change.

## Ontology

- **Publication card** (existing type, new role): `<dir>/<Name>.publication.card`, anywhere under `_content/`. It is the publication's home. Identified by `pubId`. Holds the request and notes. It is NOT approval, status, or a serving setting.
- **Request fields** (moved from `publication.json`): `title`, `connection`, `tier`, `slug` (public only), `emails` (accounts only). Agent-editable. A changed audience or destination is pending until a signed-in member approves it.
- **`pubId`** (existing, `src/publish/manifest.ts`): the stable identity and the only link to server state. One card per `pubId` in a box.
- **Publication source** (moved): `<Name>.attach/static/` or `<Name>.attach/project/`. The directory name is the content mode. Exactly one must exist.
- **Published output**: `static/` after Markdown rendering, or `project/dist/` after the build. `dist/` is generated and ignored by git.
- **Publication binding** (existing, unchanged): machine secret store record keyed by `pubId`.
- **Serving manifest and candidate** (existing, unchanged): R2 objects `pubs/<pubId>/manifest.json` and `pending.json`. The candidate's `name` becomes the card basename.
- **Orphan publication** (new term, no new data): a binding for this box with no card carrying its `pubId`.

Removed nouns: publication definition file, publication folder name, publication reference card, compatibility index, shared `NOTES.md`.

## Tracks / scope

### Track A — Card schema and duplicate check

**What.** The `publication` schema carries the request fields. A second card with the same `pubId` is a lint error: `bbx validate` and the box pre-commit hook report it. Both cards still load, because a schema sees one card at a time.

**Why this needs to change.** The card holds only `pubId` today, so it cannot be the publication.

**Direction.** Fields: `pubId` (required), `connection` (required), `tier` (required enum `public | secret | accounts | any-account`), `slug` (optional), `emails` (optional), `body`. `title` is the standard card title; the schema makes it required with the 1–200 character rule. A `superRefine` rejects `slug` unless `tier` is `public`, and requires `emails` exactly when `tier` is `accounts`. Field validators come from `definition.ts`, which keeps the zod rules and loses its file reader. A function `definitionFromCard(fields, content)` returns the existing `PublicationDefinition` type so code after local prepare does not change. Add `lintDuplicatePublicationId` beside `chat-duplicates.ts`, registered the same way for `type === "publication"`. Rewrite the schema instructions: what each field requests, that the body is for notes, where the files go, and that no approval or status belongs in the card.

**Vocabulary lock-ins.** Field names `pubId`, `connection`, `tier`, `slug`, `emails`. Directory names `static` and `project`.

**First implementation chunk.** Schema, `superRefine`, duplicate lint, `definitionFromCard`, and schema doctests. `bbx pub id` stays: the agent generates the id and writes it in the new card.

### Track B — Prepare by card

**What.** Prepare takes a card path. It reads the request from the card and the files from the card's attach scope.

**Why this needs to change.** `publications.prepare` takes `{ name }` and reads `src/publications/<name>/publication.json`.

**Direction.**

- Input `{ card: string }`, a box-relative path, resolved through `parseRef` and `resolveRefPath`. It must end in `.publication.card`.
- Local prepare reads and validates the card with the schema. It refuses when another card in the box has the same `pubId`, naming both paths.
- Source root: `attachDirFor(card)` plus `static` or `project`. Both present, or neither, is an `invalid-source` error that names the two paths. The symlink and file-type checks that `readPublicationDefinition` applies to its directory chain (`definition.ts:89-100`) apply to the card file, the attach directory, and the mode directory.
- The local prepare lock is keyed by `pubId`, not by name.
- `prepareManagedPublication` loses `ensureReferenceCard`. The candidate `name` is the card basename.
- The route returns `cardPath` and `approvalUrl`. The URL is `/<box>/browse/<card path>`; the `/views/` helper in `src/shared/publication-card.ts` is deleted.
- `listManagedPublications` builds a `pubId → card path` map once from `listBoxCardFiles` filtered to `.publication.card`. Each row has `cardPath: string | null`. `hasCard` is removed.
- `writeBoxGitignore` adds `*.attach/project/dist/`.
- Today `bbx attachments check-unlisted` and `bbx doctor annex` walk every file in an attach scope, including `node_modules/` (`unlisted-binaries.ts:122-123` skips only nested `.attach`). This plan changes the walk: it drops paths that git ignores, using `git check-ignore --stdin`, so a project's `node_modules/` and `dist/` are not reported. The commit-time guard reads the git index (`staged-unlisted.ts:65`), never sees ignored files, and needs no change.
- Ignoring `dist/` in git keeps it out of commits. It does not hide it from box-wide walkers: `listBoxCardFiles` and `listBoxMarkdownFiles` (`src/core/list-cards.ts`) and the inventory skip `node_modules` but not `dist`. A build that emits `.card` or `.md` files into `dist/` would be seen by them. The same is true of `src/publications/<name>/project/dist/` today, because those walkers cover the whole box. See NOT in scope.

**Vocabulary lock-ins.** `bbx pub prepare <card-path>`; route input `card`.

**First implementation chunk.** `definition.ts` and `prepare/core.ts` read from a card and attach scope, with `test/publish/prepare.doctest.md` rewritten to the new layout. No route change in this chunk.

### Track C — Agent can read published files

**What.** The agent can list and read the files in the active release and the pending candidate.

**Why this needs to change.** `previewFile` is restricted to a signed-in member. The boxholder approved agent read access on 2026-10-06: "it's a good debugging tool".

**Direction.** Replace `previewFile` with one read-tier query `releaseFile({ pubId, releaseId, path })`. `releaseId` must equal the manifest's active release id or the candidate's release id; any other value is rejected. Path checks, the inventory lookup, and the size and hash check stay as in `previewManagedPublicationFile` (`managed-publication-queries.ts:140`). The review UI passes the candidate's `releaseId`. List rows gain the active release's file inventory. CLI: `bbx pub files <card-path>` prints both inventories; `bbx pub cat <card-path> <file> [--pending]` prints one text file. There is no local copy, so nothing the agent can edit. Update the security report with the `security-report` skill.

**Vocabulary lock-ins.** Procedure `releaseFile`; commands `files` and `cat`.

**First implementation chunk.** The query function with a release selector and its doctest (active, pending, unknown release id, path escape).

### Track D — Remove the old surfaces

**What.** Delete what the old shape left. Add one Admin list so an orphan publication can be disabled.

**Why this needs to change.** The Publications page is a compatibility index for pointer cards. It links with `/views/` URLs. The boxholder thought it was gone.

**Direction.** Removed:

- `src/publish/publication-reference-card.ts` and its doctest.
- `publicationCardPath` and `publicationCardUrl` in `src/shared/publication-card.ts` (the file is deleted).
- `publications.ensureCard`, `commitReferenceCard`, and the `ensureReferenceCard` argument.
- `PublicationsPage.tsx`, the `/publications` route (`main/router.tsx:219,327`), the standalone-page case (`main/app-shell.tsx:116`), and the menu item (`components/AppNav/nav.tsx:60,93`).
- `bbx pub sites` and `bbx pub connections`. `bbx pub status` already prints both. `approvalLinkLines` loses its "open this box's Publications page" fallback.
- The `src/publications` layout entry (`src/lib/paths/box-layout-spec.ts:309-313`), the `_publish` description sentences that point at it (`:228-239`), and the comments at `src/shared/box-root-vocabulary.ts:43-44` and `src/publish/manifest.ts:3`.
- Old-shape text in `docs/security-report.md:205-207`, `src/core/agent-guide/guide.md:365`, and `src/core/agent-guide/ledger.yaml:706,718`.
- Old-shape expectations in `test/cli/commands/pub/managed.doctest.md` and `test/core/box/guidance-sync.publications.doctest.md`.
- Guidance rows `src/publications/CLAUDE.md` and `src/publications/NOTES.md` (`guidance-surfaces.ts:96,101`), `PUBLICATIONS_CLAUDE_MD`, `PUBLICATIONS_NOTES`, the `publications-notes` seed, and the stock hash entries.

Kept: `bbx pub id`, `prepare`, `status`; the `_publish` area (the public-site exporter uses it).

Added: the Admin Cloudflare publishing section lists orphan publications for the current box (title, serving state) with a Disable button that calls the existing `publications.disable`. `PublicationApprovalView` already handles a `pubId` with no row in `publications.list` (`PublicationApprovalView.tsx:59`: "This publication is not available in this box."). A new card is in that state until its first prepare, so the message changes to "Not prepared yet" with the prepare command for this card. The list stays binding-driven.

The Admin section is visible to the owner only (`cloudflare-publish-connections.ts` uses `authenticatedOwnerProcedure`). The Disable button calls `publications.disable`, which admits any signed-in member, so no authority changes. A member who is not the owner does not see the orphan list. Their recovery path is the agent: `bbx pub status` lists orphans, and a new card with that `pubId` brings the controls back.

Finding publications uses search with the `publication` kind and the box's own folders. No list view is added.

**Vocabulary lock-ins.** None new.

**First implementation chunk.** Delete the page, route, menu item, `ensureCard`, and the reference-card module; fix imports and doctests. This chunk depends on Track B's list change.

### Track E — Box guidance and docs

**What.** Rewrite agent-facing and operator docs to the new shape.

**Direction.**

- `docs/box/publishing.md`: rewrite sections at lines 14, 80, 82, 129, 542 and 645. One example card plus `static/`; the project variant; notes in the card body; prepare by card path; `files` and `cat`. State the 1 MB limit for file types outside the asset list in `static/`.
- `docs/publishing.md` section at line 156; `docs/box-layout.md:78,197,256,262`; `docs/box-guidance.md:43,46`; `docs/box/markdown.md:8`.
- Ledger entry `box-code.publications` (`src/core/agent-guide/ledger.yaml:717`) is replaced by one that points at the card and the installed guide.
- Mark `publish-sites-admin.md` and `publication-approval-card.md` with a note that this plan supersedes their source and card shape. Their other tracks stand.
- Regenerate `box-docs/`, the doc graph, and template hashes.

**First implementation chunk.** The installed guide `docs/box/publishing.md`, because the knowledge audits read it.

### Track F — Box migration

**What.** One script migration, `publication-cards`, converts every box.

**Direction.** For each `src/publications/<name>/publication.json` that parses:

1. Find `.publication.card` files with that `pubId`. Keep one: the card at the old default path if present, otherwise the first by path. Append the bodies of any others to it and delete them.
2. Write the kept card as `<name>.publication.card` in its current directory, or `_content/publications/` when none existed. Fields come from the JSON; `title` is the JSON title; the body is preserved. If the target filename exists, keep the card's current filename.
3. Move `site/` to `<Name>.attach/static/` or `project/` to `<Name>.attach/project/`, by the JSON `content` value. Do not move `node_modules/` or `dist/`; delete them. Prepare rebuilds both.
4. Delete `publication.json`. Remove the folder when it is empty. A second, unselected source directory stays in place and is reported.

Then:

- Any `.publication.card` that step 2 did not convert cannot satisfy the new schema. This includes a pointer card whose `publication.json` is missing or invalid. With an empty body it is deleted. With a body it is renamed to `<basename>.md`, with a first line that states its publication has no source in the box. Its site, if live, appears in the Admin orphan list.
- `src/publications/CLAUDE.md`: delete on a stock hash, otherwise park, as `retire-process-pages` does.
- `src/publications/NOTES.md`: delete when it equals the shipped seed. Otherwise move it to `_content/publications/NOTES.md` and add one link line to each migrated card body.
- Regenerate `.gitignore` first, so the `dist/` rule is present before the commit.
- An invalid `publication.json` is left in place and reported. Its pointer card gets the treatment above, so the commit still validates.

Server state is not touched. `pubId`, bindings, manifests, and URLs do not change, so live sites keep serving. The whole conversion is one script and one registry entry, so its single commit validates against the new schema (`src/scripts/migrate/card-fields/run.ts:7-8`).

**First implementation chunk.** The script and `test/scripts/migrate/publication-cards.doctest.md` covering: static site with a pointer card, project site with `dist/` and `node_modules/`, no pointer card, moved pointer card, two alias cards, a pointer card with no source, edited and stock `NOTES.md`, and a rerun that changes nothing.

## Could this be simpler?

The simplest version keeps `src/publications/<name>/` and replaces `publication.json` with a card inside it. It needs no attach-scope work and a smaller migration. It fails the stated job: the card cannot move, it sits in a code area that the card browser does not present as content, and the publication still has a fixed home that the card does not choose.

Within the chosen design, three things were cut:

- Prepare does not assign `pubId` and write it into the card. That needs a server write to a box card and a cross-process lock. `bbx pub id` is one existing command.
- No publications list view. Search by kind exists.
- No unbind or delete of server bindings. Disable exists; removal of a binding is a separate authority decision.

The Admin orphan list is the one addition beyond removal. Without it, a live site whose card was deleted has no visible control.

## Subplans

None. The schema, layout, and authority boundary are settled above.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Card is copied; two cards carry one `pubId` | Planned: duplicate lint doctest, prepare doctest | Validation error on both cards; prepare refuses and names both paths | Clear |
| Card has both `static/` and `project/`, or neither | Planned: prepare doctest | `invalid-source` error naming the paths | Clear |
| Card is moved with `mv` and the attach folder is left behind | Planned: prepare doctest (no source) | Same `invalid-source` error; guide says to use `bbx mv` | Clear |
| Agent edits `tier` or `emails` on a live publication | Existing managed-publications doctest | Requested scope differs from approved scope; old scope stays live until a member approves | Clear |
| Agent copies a `pubId` from another box | Existing binding doctest | `reserveCloudflarePublishBinding`: "This publication id is already bound to a different box." | Clear |
| Agent changes `pubId` on an existing card | Planned: prepare doctest | A new binding and a new disabled publication are created; the old one becomes an orphan and stays in its last approved state | Clear in Admin orphan list |
| Card deleted while the site is live | Planned: list doctest, Admin frontend doctest | Row has `cardPath: null`; Admin lists it with Disable | Clear |
| `static/` holds a file over 1 MB with an unlisted extension | Existing staged-unlisted doctest | Box commit is blocked with the guard's message | Clear |
| Project `dist/` or `node_modules/` gets committed | Planned: gitignore doctest | Ignore rules | Clear |
| `releaseFile` is called with a release id that is neither active nor pending | Planned: query doctest | Rejected | Clear |
| Migration meets two alias cards for one `pubId` | Planned: migration doctest | Keep one, merge bodies, delete the others, print a warning | Clear |
| Migration meets a pointer card with no source | Planned: migration doctest | Delete or convert to `.md`; site shows in Admin orphan list | Clear |
| Migration is interrupted | Planned: rerun case in migration doctest | Each publication converts independently; a rerun completes the rest | Clear |
| Prepare runs after deploy and before the migration sweep | No test | Prepare by name no longer exists; the old CLI argument fails as "not a publication card" | Clear; window is the deploy itself |
| A fresh clone has annex pointer files, not image bytes, in `static/` | No test | None. Prepare would publish the pointer text. This risk exists today because `annex.largefiles` is unscoped (`docs/plans/asset-annex.md:895`) | Silent; accepted, not new, see NOT in scope |

No critical gap is new to this plan.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. `superRefine` rejects `slug` on a non-public tier and missing `emails` on `accounts`; the card fails to load with the field named.
- **Stale ref:** ADDRESSED. Identity is `pubId`, so a moved or renamed card needs no server change. A stale path given to prepare fails as not found.
- **Two agents touching the same card:** ADDRESSED. Prepare only reads the card. The local prepare lock is keyed by `pubId`; remote writes keep the existing per-publication lock (`managed-publications/core.ts:187`).
- **Hand-edit drift:** ADDRESSED. The card validates on load. No server state is read from it.
- **Fabricated free-form value:** ADDRESSED. `connection` must match a granted connection; `pubId` must pass the binding check; audience values only become live through member approval.
- **Validation error UX:** ADDRESSED. Errors name the card path and the field, or both conflicting cards.
- **Partial migration / transition state:** ADDRESSED. Live serving does not depend on the box layout. An unconverted publication cannot be prepared until the migration converts it; the migration reports every publication it left.

## NOT in scope

- Changing approval, audience, host, Worker, R2 layout, or the candidate schema. The authority boundary is fixed.
- Assigning `pubId` at prepare time. Cut above.
- A list view of publications. Search by kind covers it.
- Unbinding or deleting a server binding. Needs its own authority decision.
- Rendering the card body as a site page. The body is notes.
- Detecting annex pointer files in a source tree. The risk exists today and is not caused by this move; file it as an issue.
- The file watcher descending into a project's `node_modules/`. `src/core/box/file-watcher.ts:36,43` ignores only dot-segments and two high-churn trees, and it watches `src/publications/<name>/project/` the same way today; file it as an issue.
- Hiding a project's `dist/` from box-wide card and Markdown walkers. The exposure is the same before and after the move; file it with the watcher issue.
- Markdown link checks on site pages. `listBoxMarkdownFiles` is box-wide, so site `.md` files are checked the same way before and after.
- Adding font or SVG extensions to the asset list. That list drives `annex.largefiles` for every box.

## Open design questions

- **Publications page replacement.** The boxholder has not answered. Lean, written into Track D: remove the page and menu item, add the Admin orphan list, add no list view.
- **Edited `NOTES.md`.** Lean: move it to `_content/publications/NOTES.md` and link it from each migrated card. The alternative is to append its text to every card.
- **`bbx pub sites` and `connections`.** Lean: remove both, since `status` prints the same lines.

None of these is inside a first implementation chunk of Tracks A, B, or C.

## Knowledge audits

The eight publishing audits in `src/dev/knowledge-audits.yaml` (ids `publishing-*`, lines 7226–7426) change with the guide:

- Rewrite `publishing-site-authoring` and `publishing-markdown-documents` to the card and `static/` shape.
- Rewrite `publishing-private-notes-scope` to "notes go in the card body".
- Update `publishing-audience-approval` and `publishing-secret-link-and-approval` for request fields in the card.
- Add one `knows_directly` audit: how to see what is published (`bbx pub files`, `bbx pub cat`).

Run the changed audits against the worktree's test box and record the status comments.

## What will hold this after it ships

- Doctests reach every decision: card-to-definition and mode selection are pure functions over a card and a directory; the duplicate lint has its own doctest; `releaseFile` is tested through the fake runtime and store.
- `test/publications/managed-publications.doctest.md` covers prepare through candidate with the fake Cloudflare services. No real credentials or API calls.
- The migration doctest is the regression anchor for existing boxes.
- Frontend doctests cover the renderer's unbound state and the Admin orphan list.
- `pnpm lint:knip` confirms that nothing from the removed modules is still exported or imported.
- A final grep for `publication.json`, `src/publications`, `ensureCard`, `PublicationsPage`, and `/views/` under `beebox/src`, `beebox/docs` (outside plan history), and tests must return nothing.

## Implementation order

Tracks run serially; all touch `beebox/`.

1. Track A: schema, duplicate lint, `definitionFromCard`.
2. Track B: prepare by card, list rows, route, CLI `prepare`, `.gitignore`, unlisted walk.
3. Track C: `releaseFile`, CLI `files` and `cat`, security report.
4. Track D: removals and the Admin orphan list.
5. Track F: migration script and doctest.
6. Track E: guide, docs, ledger, knowledge audits; regenerate generated docs.
7. Cross-model review of the full diff; final grep; `test:changed`, typecheck, lint.

The plan ships as one piece. Landing on `main` deploys and runs the migration, so it needs the boxholder's go-ahead.

## Rollout shape

Tests first per chunk: the doctest named in each track's first chunk is written with the code, and done means those doctests, `pnpm typecheck`, and `pnpm lint:changed` pass.

Scenario walk against the code, to repeat after implementation in the worktree test box with the fake services:

1. **Create.** The agent writes `Trip.publication.card` with `bbx pub id` output and puts `index.md` in `Trip.attach/static/`. Validation passes.
2. **Prepare.** `bbx pub prepare _content/…/Trip.publication.card` returns the candidate and a `/browse/` URL.
3. **Review and approve.** The card page shows the candidate; a signed-in member enables it. The agent's call to `enable` is rejected.
4. **Refresh.** The agent edits `index.md` and prepares again; content updates under the approved scope. A `tier` edit stays pending.
5. **Inspect.** `bbx pub files` and `bbx pub cat` show the active release.
6. **Move and rename.** `bbx mv` moves the card and its attach folder; prepare by the new path works; the binding is unchanged.
7. **Disable.** A member disables it from the card. Delete the card; the Admin list shows the orphan.
8. **Migrate.** Run the migration on a fixture box in the old shape; prepare the migrated card; the release id equals the pre-migration release id for unchanged files.

The migration is scripted and atomic per box. It runs in the deploy sweep. Before landing, show the boxholder the migration's dry-run output for the worktree test box.
