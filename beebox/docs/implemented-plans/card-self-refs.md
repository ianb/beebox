---
title: "Card self-refs: attach-scope repair, bbx mv fixes, lock guard vocabulary"
status: implemented
workstream: card-self-refs
issues:
  - ../../../issues/closed/bugs/2026-09-16-flat-layout-media-cards-with-absolute-refs-fail-to-load.md
  - ../../../issues/closed/bugs/2026-09-16-bbx-mv-refuses-plain-md-files.md
  - ../../../issues/closed/bugs/2026-09-16-bbx-mv-directory-leaves-self-refs-stale.md
  - ../../../issues/closed/bugs/2026-09-16-reactor-lock-guard-dir-blocks-every-commit.md
---
# Card self-refs: attach-scope repair, bbx mv fixes, lock guard vocabulary

Legacy media cards name their own file with a box-absolute `filename.ref`
instead of `attach/<file>`. The image loader refuses that form, and `bbx mv`
of a directory leaves such refs stale. This plan repairs the legacy shape once
with a migration, fixes the two `bbx mv` gaps, and fixes an unrelated
box-root vocabulary gap that blocks commits while a reactor runs.

**Issues addressed:** the four in frontmatter. A queue grep for
`filename.ref`, `flat layout`, `.guard`, `bbx mv` and `attach scope` found no
duplicates.

## Smallest fix and budget

The smallest fix for the reported symptom ("Failed to load") is to make the
loader accept any in-box ref. That fix is rejected: the schemas state that
`filename.ref` is always `attach/<name>` (`src/core/commands/pdf-reanalyze.ts:51`:
*"The ref is always `attach/<name>` (the schema's own contract)"*), and at
least three readers depend on that (`box-image.ts:43`,
`capture/transcribe-clips.ts:90` via `resolveAttachRef`, `pdf-reanalyze.ts:59`).
Loosening one reader leaves the others broken. The boxholder chose repair
(issue body, "Direction (2026-09-16)").

Chosen design, five tracks:

| Track | Source | Tests |
|---|---|---|
| A. Lock guard vocabulary | ~30 | ~30 |
| B. Loader card-stem fix | ~10 | ~25 |
| C. `bbx mv`: absolute refs in moved cards | ~15 | ~50 |
| D. `bbx mv`: plain `.md` source | ~35 | ~60 |
| E. Migration + lint warning | ~300 | ~250 |

Total about 800 changed lines, well under the BIG CHANGE threshold. Authored
docs (the `docs/cards/migrations.md` table entry, this plan) are about 60 lines on
top.

## Stated preferences this plan trades against

- Boxholder, 2026-09-18: *"we can just do best effort and allow an agent to
  fix it up via an agent if necessary"*, and *"I don't think the migration has
  to error, this isn't fatal really."* The migration repairs confident cases,
  reports the rest, and exits 0.
- Boxholder decision on `bbx mv` (issue body): *"`bbx mv` must accept a single
  `.md` file, with the same ref and link rewriting as a card move. Do not
  change the guide instead."*
- `bbx-migration` skill: *"Do the mechanical 80% as a script and let an agent
  handle only the residual."* The residual reaches an agent through a
  `bbx validate` warning, not a procedure migration.
- `bbx-migration` skill: *"Be idempotent."* A repaired card has an `attach/`
  ref and is skipped on the next run.
- Memory "consolidate over blast-radius": the two copies of the vocabulary
  name set (`box-root-check.ts:22`, `validate-hook.ts:43`) become one
  predicate.

## What already exists

- **Ref rewriting across the box** — `src/core/rewrite-card-refs.ts`:
  `rewriteReferrerRefs` (`:301`), `collectCardRefTokens` (`:397`),
  `rewriteCardRefTokens` (`:407`), `rewriteViewRefs` (`:337`). Reused by the
  migration for inbound refs and for the card's own tokens. Precedent:
  `scripts/migrate/todo-list-to-doc-run.ts:32-33` imports the same functions.
- **Box file listing** — `listBoxCardFiles`, `listBoxMarkdownFiles`,
  `listBoxViewFiles` in `src/core/list-cards.ts`. Reused.
- **Attach path helpers** — `src/shared/attach-path.ts`: `cardBasename`,
  `attachDirFor`, `resolveAttachRef` (`:99`). Reused by Track B and Track E.
- **Moved-card transform** — `transformForMovedCard`
  (`rewrite-card-refs.ts:156`). Track C changes it. It currently returns early
  on absolute refs, `:165`: *"if (parsed.path === "" ||
  parsed.path.startsWith("/") || isAttachRef(parsed.path)) { return rawRef; }"*.
- **Card move** — `moveOne` (`move-operations.ts:330`) and
  `movePhase2CardFiles` (`move-phase2.ts`). Track D reuses `moveOne` for `.md`.
- **Per-card lint** — `lintCard` in `src/core/card-lint.ts`, which already
  emits ref warnings (`:236-246`). Track E adds one warning there.
- **Migration registry** — `MIGRATIONS` in `src/core/migrations.ts`
  (append-only, `:52` onward).
- **Lock guard name** — `guardPath` in `src/lib/file-lock.ts:254`:
  *"return `${lockPath}.guard`;"*.
- **Prior vocabulary fix** — commit `f036c06b3` added `.bbx-maps-ignore` as
  one line plus comment. Track A follows the same place but derives the name.

Searched for a current producer of the flat layout: the capture writer
(`src/core/capture/write-cards.ts:63`, *"const childAttachRel =
`${this.sessionAttachRelDir}/${opts.childBasename}.attach`;"*) and scan import
(`commands/scan-import-cards.ts:97-101`) both write attach scopes. A grep of `src/`,
`templates/` for a non-`attach/` `filename.ref` writer found none. The flat
layout is legacy-only, so a one-time migration is the right shape. Git history
before 2026-08-30 was rewritten, so the date of the switch is unknown.

## Prior art (external)

No design decision depends on an external premise. One internal premise was
checked: box media uses unlocked git-annex (pointer files, not symlinks —
`src/lib/asset-content.ts:4`: *"an asset's working-tree file holds either the
bytes or a ~100-byte pointer"*). So a plain `rename` of a media file into a
deeper directory does not break it.

## Tracks / scope

### Track A — lock guard directories are legal box-root entries

- **What:** Accept `<name>.guard` at the box root for every `tooling` entry
  whose name ends in `.lock`.
- **Why:** `file-lock.ts` creates `.bbx-reactor.lock.guard/` for the life of
  the lock. `checkBoxRoot` reports it as a stray, so the pre-commit root check
  fails every commit in the box, `bbx finish` included.
- **Direction:** New pure module `src/lib/lock-guard.ts` exporting
  `LOCK_GUARD_SUFFIX = ".guard"` and `lockGuardPath(lockPath)`. `file-lock.ts`
  uses it in place of its private `guardPath`. `box-root-vocabulary.ts` exports
  `isBoxRootVocabularyName(name: string): boolean`, which accepts listed names
  and `<listed .lock name>.guard`. `box-root-check.ts` and `validate-hook.ts`
  call it instead of building their own name sets. `lock-guard.ts` has no Node
  imports, because `src/shared/display-path.ts` imports the vocabulary module
  into the frontend.
- **`.gitignore`:** no change. The guard directory is always empty
  (proper-lockfile only `mkdir`s and `utimes` it), and git does not track
  empty directories. The pattern gap in the issue has no effect.
- **Vocabulary lock-ins:** `isBoxRootVocabularyName`, `LOCK_GUARD_SUFFIX`.
- **First chunk:** the module, the predicate, both callers, a case in
  `test/lib/box-root-check.doctest.md`. No open questions.

### Track B — image loader computes the card stem with the shared helper

- **What:** `resolveImageCard` computes the attach scope with
  `resolveAttachRef` instead of its own regex.
- **Why:** `box-image.ts:51` strips every dotted segment:
  `stem = cardBaseName.replace(/(\.[^.]+)*\.card$/, "")`. `Mr. Smith.image.card`
  gives `Mr`, so the loader looks in `Mr.attach/` and fails. `cardBasename`
  gives `Mr. Smith`. Found while checking the anchor issue; same function.
- **Direction:** Replace the stem code with `resolveAttachRef(cardAbs, ref)`.
  The loader stays `attach/`-only.
- **First chunk:** the change plus a case in
  `test/webapp/routes-api-images.doctest.md`. No open questions.

### Track C — `bbx mv` rewrites absolute refs held by moved cards

- **What:** When a card moves (alone or inside a directory), its own
  box-absolute refs to anything that also moved are rewritten.
- **Why:** `transformForMovedCard` returns every `/`-leading ref unchanged
  (`rewrite-card-refs.ts:165`). A card inside a moved directory keeps
  `/old/dir/photo.jpg`. A single card with `/dir/Foo.attach/p.jpg` keeps the
  old attach path too. 27 cards on one box went stale this way.
- **Direction:** In `transformForMovedCard`, an absolute ref resolves to its
  target, goes through `remap`, and when remapped is written back absolute
  (`restyleRef` with `wasAbsolute: true`). An absolute ref to a target that did
  not move stays unchanged. Relative and `attach/` handling does not change.
- **First chunk:** the change plus two cases in
  `test/core/commands/move-command.doctest.md` (directory move with an
  absolute self-ref; single card with an absolute ref into its own attach
  scope). No open questions.

### Track D — `bbx mv` accepts a plain `.md` file

- **What:** A `.md` source moves like a card: the file moves, inbound refs and
  links are rewritten, its own relative links are recomputed.
- **Why:** `move.ts:210` refuses it (*"Source must be a .card file or
  directory"*), while `core/agent-guide/cards.ts:133` and `core/sdk-hooks.ts:144`
  tell agents it works.
- **Direction:** `handleSource` accepts `isCardFile(sourcePath) ||
  isMarkdownFile(sourcePath)`. The destination must keep the source's kind: a
  `.md` source needs a `.md` destination, a `.card` source a `.card`
  destination (error text names the required extension). `moveOne` and
  `movePhase2CardFiles` skip the attach-directory step for a `.md` source,
  because a `.md` file has no attach scope; `attachDirFor("x.md")` returns
  `x.md.attach`, which does not exist, but skipping states the rule instead of
  relying on that. Error wording becomes "Source must be a .card file, a .md
  file, or a directory".
- **First chunk:** the change plus doctest cases: move a `.md` into a
  directory; inbound link from a card and from another `.md` rewritten; the
  moved file's own relative link recomputed; `.md` → `.card` destination
  refused. No open questions.

### Track E — migration `filename-attach-scope` and a lint warning

- **What:** A script migration moves each confidently-owned media file into
  its card's attach scope and rewrites refs. A `bbx validate` warning flags
  every card still carrying a non-`attach/` `filename.ref`.
- **Why:** Legacy capture cards render "Failed to load" (1,025 image and 103
  audio cards on one box before hand repair). Other boxes may still carry them.
- **Direction — scope:** frontmatter cards of the four types whose schema
  declares `filename.ref` into the attach scope: `image`, `audio`, `file`,
  `pdf` (`FilenameEntry` in each schema module). XML cards are skipped and
  listed.
- **Direction — the confidence rule.** Pure function
  `classifyFilenameRef(input) → Decision`, exported for the doctest. A card is
  repaired only when all hold:
  1. `filename.ref` does not start with `attach/` and is not a URL.
  2. The target file is found by one of two routes:
     a. the ref resolves in the box (`resolveRefPath`) to an existing regular
        file in the card's own directory; or
     b. the ref is dangling, and a regular file with the ref's basename
        exists in the card's own directory. This is the `bbx mv` damage from
        Track C's bug: the directory moved, the file moved with it, the ref
        kept the old directory.
  3. No other card in the box has a `filename.ref` resolving to the same
     file (counted over all four types, by route a or b).
  4. `<card basename>.attach/<file>` does not exist, or has identical bytes
     (then the flat copy is removed instead of moved).

  Anything else is `ambiguous` with a reason: `outside-card-dir`,
  `not-found`, `shared-with <other card>`, `destination-differs`,
  `target-is-card`, `external-url`, `escapes-box`. Cards without frontmatter
  are listed separately. A card's stem is not required to match the file's stem. The
  worked example in the issue (`photo-004.jpg` beside
  `photo-004-<title>.image.card`) passes, and so does `IMG_1234.jpg` beside
  `Beach.image.card`. Rules 2–4 already establish ownership: the card names
  the file, the file is next to it, and no other media card claims it.
- **Direction — apply:** per repaired card, `mkdir` the attach scope and
  `rename` the file into it. Then one pass over every card, `.md` and view
  with a combined `remap` (old file → new file): the repaired card's own
  tokens that resolve to its file become `attach/<file>` (collected with
  `collectCardRefTokens`, replaced with `rewriteCardRefTokens`); every other
  referrer goes through `rewriteReferrerRefs` / `rewriteViewRefs`, which
  keep each ref's absolute or relative style. For route b, the stale path the
  dangling ref named is remapped too, so other cards holding the same stale
  ref are repaired with it.
- **Direction — report and exit:** prints counts, then each ambiguous card
  with its reason. Exits 0 when only ambiguous cards remain; exits 2 only on
  an I/O failure (precedent: `gsheet-rename.ts`, *"if (report.failed.length >
  0) process.exit(2);"*). Dry-run by default, `--apply` to write.
- **Direction — lint warning:** in `lintCard`, for those four types, a
  `filename.ref` that is not `attach/…` warns:
  `filename.ref should point into the card's attach scope: move <file> into
  <basename>.attach/ and write attach/<file>`. This is where the ambiguous
  tail stays visible to a box agent after the migration has run; migration
  stdout is not kept.
- **Vocabulary lock-ins:** migration name `filename-attach-scope` (manifest
  key, permanent). Reason codes are output text, not stored.
- **First chunk:** `scripts/migrate/filename-attach-scope.ts` with
  `classifyFilenameRef` and the doctest for the rule table. No open questions.

### Track F — `v2-refs-to-v3` migration (added at /finish, boxholder request)

- **What:** Rewrite box-absolute refs still in v2 layout (`/store/…`) to the
  v3 path `mapV2Path` gives, only when that target exists in the box
  namespace. Cards and `.md` files; fenced examples untouched.
- **Why:** The test-box run found a stock-procedure-derived card holding
  `/store/archive/briefs/…`; the boxholder asked, at /finish, to "try to fix
  v2 refs if they exist". Registered before `filename-attach-scope`, so a
  v2-form `filename.ref` reaches that migration in v3 form.
- **Test:** `test/scripts/migrate/migrate-v2-refs-to-v3.doctest.md`.

## Could this be simpler?

- **Simplest:** loosen the image loader to accept any in-box ref, and skip the
  migration. Fails on audio transcription (`transcribe-clips.ts:90` requires
  `attach/`) and pdf reanalysis (`pdf-reanalyze.ts:59`), and leaves the cards
  one `bbx mv` away from going stale again. Rejected by the boxholder's
  "Direction" decision.
- **Simpler migration:** only route 2a (drop the dangling-ref route 2b).
  Route 2b is about 15 lines and covers the damage the Track C bug already
  did on boxes other than the hand-repaired one. Kept.
- **Simpler lock fix:** add `.bbx-reactor.lock.guard` as one literal entry.
  Works today; the next root-level lock repeats the outage. The derived rule
  costs one predicate and removes the duplicate name sets. Kept.
- **No lint warning:** the migration output is lost after the sweep, so the
  ambiguous tail would be invisible. The boxholder wants an agent able to
  finish the tail; the warning is how an agent finds it. Kept.
- **Agent-repair procedure for the tail:** not built. The boxholder said the
  migration should not error; the lint warning is enough for an agent.

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Two media cards name the same flat file; migration moves it into one scope and the other breaks | Doctest case (planned) | Rule 3 → `shared-with` | Clear (reported + lint) |
| Destination `<basename>.attach/<file>` already holds different bytes | Doctest (planned) | Rule 4 → `destination-differs` | Clear |
| A doc card body links the flat file by absolute path | Doctest (planned) | Combined remap rewrites it | Clear (listed in output) |
| A non-card file (JSON config, a script) names the flat path | No | No | Silent — same limit as `bbx mv`; accepted |
| Migration run twice | Doctest (planned) | `attach/` refs skipped | Clear ("0 to repair") |
| Card title with a dot (`Mr. Smith.image.card`) | Doctest (planned) | Uses `cardBasename` in both loader and migration | Clear |
| Dangling ref whose basename matches an unrelated file in the directory | Doctest (planned) | Rule 3 counts claimants; otherwise accepted risk | Silent if the unrelated file is unclaimed — accepted: the card's ref already named that basename |
| `.md` moved to a `.card` destination | Doctest (planned) | Kind check in `handleCardSource` | Clear error |
| Guard dir of a non-root lock | n/a | Only root entries are checked | n/a |

No critical gaps. The non-card referrer row is an accepted risk: `bbx mv`
has the same limit, and those files are code or config, not box content.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED — only `filename.ref` of four types is
  examined (Track E scope).
- **Stale ref:** ADDRESSED — route 2b and Track C.
- **Two agents on one card:** ADDRESSED — migrations run through `bbx migrate`
  and the sweep, which own dirty-tree policy (`migration-run.ts:6`).
- **Hand-edit drift:** ADDRESSED — a hand-written absolute `filename.ref`
  after the migration gets the lint warning.
- **Fabricated value:** not applicable; no free-form value is written.
- **Validation error UX:** ADDRESSED — the warning names the file, the
  target directory and the ref to write.
- **Partial migration:** ADDRESSED — each card is repaired independently and
  a re-run skips repaired cards. An interrupted run between `rename` and the
  ref rewrite leaves a dangling ref whose basename is in the attach scope, not
  the card directory; a re-run reports it `not-found`. Accepted: the window is
  one rename, and the lint warning flags the card.

## NOT in scope

- Loosening any `filename.ref` reader — rejected above.
- A procedure (agent) migration for the ambiguous tail — the boxholder
  declined an erroring migration; the lint warning is the hand-off.
- Rewriting refs in non-card files (config, box `src/`) — `bbx mv` does not
  either; separate concern.
- `.gitignore` change for `.guard` directories — no effect, see Track A.
- Moving other file kinds (`.json`, `.tsx`) with `bbx mv` — not requested.
- Running the migration on production boxes or `~/src/boxes/*` — needs the
  boxholder; ships with the ordinary deploy sweep.

## Open design questions

None. Settled: migration exits 0 on ambiguous cards (boxholder, 2026-09-18);
no `validate --fix` path (no current producer; lint warning is check-only).

## Knowledge audits

Skipped. No new agent-facing concept: `attach/` refs and `bbx mv` on `.md`
are already taught (`core/agent-guide/cards.ts:133`). The new lint warning
carries its own fix instruction.

## What will hold this after it ships

All doctest tier:

- `test/lib/box-root-check.doctest.md` — guard directory accepted; an
  unrelated `.guard` name still a stray.
- `test/webapp/routes-api-images.doctest.md` — loader resolves a dotted card
  name; still refuses a non-`attach/` ref.
- `test/core/commands/move-command.doctest.md` — absolute self-refs follow
  directory and card moves; `.md` source accepted with rewriting.
- `test/scripts/migrate/migrate-filename-attach-scope.doctest.md` — the rule
  table through `classifyFilenameRef`, and an end-to-end run on a temp box
  (dry-run changes nothing; `--apply` repairs; second run is a no-op).
- A card-lint doctest case for the warning (existing card-lint doctest file).

## Implementation order

1. Track A (independent; can land alone).
2. Track B.
3. Track C.
4. Track D.
5. Track E: classifier + doctest, then apply path, then registration and
   `docs/cards/migrations.md` entry, then lint warning.
6. Run the migration against this worktree's `test1` clone with fixture cards
   written into it: dry-run, `--apply`, `bbx validate`, manifest entry.
7. Cross-model review of the branch.

## Rollout shape

Done when the doctests above pass, typecheck and eslint are clean, and step 6
succeeds. The migration ships as a registered script and runs through the
deploy sweep on every box. It adds no back-compat read path, so no
legacy-removal issue is needed.
