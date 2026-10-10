---
title: "Retire the four type-specific core Markdoc tags"
status: draft
workstream: plugins-planning
issues: []
---
# Retire the four type-specific core Markdoc tags

The core Markdoc tag table carries four tags that belong to one card type each: `purpose` and `correction` (briefing cards), `image` and `silence` (capture-session cards). This plan removes all four. The briefing's purpose becomes a frontmatter string, corrections become a plain `## Corrections` section, the capture transcript links to each photo's image card with an ordinary markdown link, and a silence gap becomes plain text. A script migration converts every existing card. After this, the core table holds only tags that make sense in any card body, and the question of scoping built-in tags (raised in `docs/implemented-plans/plugins-slice-2.md`, "Open design questions") is closed by having none to scope.

**Issues addressed:** none. Searched `issues/` for `purpose %`, `correction %`, `{% image`, `{% silence`, `briefing` with `frontmatter`, and `capture` with `marker`. One hit, `issues/docs-and-chores/2026-06-02-chat-output-vocabulary-ia-pass.md:12`, lists the briefing tags as a "domain vocabulary" to load only when editing briefings. This plan makes that point moot for briefings; the issue stays open for its other items.

## Design

### Situations

- When I am setting up a new box and the agent asks what it is for, I want my answer stored where I can see and edit it in one line, so I can change it later without learning a tag.
- When an agent keeps making the same mistake, I want to write the rule down in the briefing as ordinary text, so I can read the list of rules the way I read any other section.
- When I open a capture transcript, I want each photo to be a link I recognize, so I can click through to the picture and its description.
- When I read a transcript, I want long pauses marked in plain words, so I can see where I stopped talking without the marker drawing attention.
- When I write a memo, I do not want briefing or capture markup to be valid there; a typo of `{% purpose %}` in a memo should be an error, not silently accepted.

### Right place, right time

| Situation | Act, show, or quiet | Surface and card | Attention |
|---|---|---|---|
| Purpose recorded | Show: a `purpose` line in briefing frontmatter | Briefing card page; compiled into `_content/briefing.md` | Waits to be found |
| Correction added | Show: a bullet under `## Corrections` | Briefing card body; compiled into `_content/briefing.md` | Waits to be found |
| Photo in a transcript | Show: a markdown link to the image card | Capture-session card body | Waits to be found |
| Pause in a transcript | Show: one dim line of text | Capture-session card body | Background |
| Tag typed in another card | Act: validation error `Undefined tag` | `bbx validate`, card lint | Interrupts the author |

### Spirit

- **Serves:** "The box is plain files" — a purpose line and a corrections list read as text, with no vocabulary to learn.
- **Risks:** "Make honesty easy" — a corrections bullet has no slot for the `test` attribute, so the way to check a correction can be left out. Guard: the briefing instructions ask for a trailing "Test: …" sentence, and the knowledge audit `briefing-corrections-section` checks the agent knows to write one.

### Trust

Shows only, takes no action. The migration is a deterministic script run by `bbx engine migrate`; it fails closed and writes nothing when it meets a shape it cannot convert.

### When it goes wrong or does nothing

- A briefing card still carrying `{% purpose %}` after the engine upgrade (migration not yet run) renders the tag as muted authored text (the unknown-tag fallback from slice 2) and `bbx validate` reports `Undefined tag 'purpose'` with the file and line. The fix is `bbx engine migrate`.
- A migration that finds two purpose blocks, or a purpose block and a `purpose:` frontmatter key with different text, prints both locations and exits 1 with nothing written. The person resolves it by hand and re-runs.
- A capture-session card with an image link whose card was moved shows an ordinary dangling card link, the same as any other body link; `bbx validate` reports the dangling ref the same way it does for any link.

### Walkthrough

A boxholder records a two-minute voice note with one photo. The capture worker writes the session card body: a paragraph of speech, then `[photo-001](attach/photo-001.image.card)`, then `— 26s silence —`, then more speech. On the card page the link renders through the existing card-link component with the image card's label, and clicking it opens the image card. The agent annotating the capture reads the body as markdown and follows the link like any other ref. Nothing else is left behind.

## Smallest fix and budget

**Smallest fix:** delete the four tag rows and their components, change the two producers (briefing template, capture timeline), and tell boxholders to edit their cards by hand. This leaves 23 briefing cards and 19 capture cards across six production boxes (counts from 2026-10-10, see Rollout shape) failing validation until someone edits them, and 56 image markers in one box alone. A hand migration of generated capture bodies is not reasonable work for a person.

**Chosen design:** the smallest fix plus a script migration that converts every card in one pass, fail-closed. Tracks:

| Track | Source | Tests |
|---|---|---|
| 1. Briefing: frontmatter purpose, corrections section | ~120 changed (about 60 added, 60 deleted) | ~60 |
| 2. Capture: links and text in the timeline | ~15 | ~15 |
| 3. Remove the tags, components, emitter cases | ~210 deleted | ~10 |
| 4. Migration script and registry entry | ~260 | ~140 |

Source plus tests about 830 changed lines. Authored docs and instructions about 120 lines (schema instruction strings, `docs/box/what-you-could-do.md`, `docs/cards/migrations.md`, knowledge audits). Generated output: the briefing seed stock hash (one line). Not a BIG CHANGE. The fuller design buys a working box on the day the engine lands: an unmigrated card fails validation loudly (principle 4 in `docs/engineering-principles.md`, "never silent"), and the bbx-plan skill rules that a migration expected to stop midway is a subplan, so this one runs to completion or writes nothing.

## Stated preferences this plan trades against

- **Boxholder decision 2026-10-10** (paraphrase, from the plugins-planning session): purpose and correction could be frontmatter; image could link the image; silence as text or convention; "do all that". Correction became a section rather than frontmatter during the same discussion, because corrections are prose and the markdoc-tags plan moved them out of YAML for that reason (`docs/implemented-plans/markdoc-tags-plan.md:149-152`: *"Reading a raw briefing card means scanning awkward imperative-prose-in-YAML"*). This plan puts one short string, the purpose, back in frontmatter and keeps the prose in the body. The boxholder agreed to this split.
- **`docs/implemented-plans/markdoc-tags-plan.md:158-160`**: *"Move ALL semantic content to the body as Markdoc tags."* This plan reverses that for `purpose` only. The reason it was moved was the YAML prose problem; a one-line purpose does not have it, and `src/core/judgment/situation.ts:20` already reads the purpose as a single string with a regex, which a frontmatter key makes unnecessary.
- **`docs/implemented-plans/plugins-design-notes.md:140`**: tags are local to the type. This plan honors it by deletion instead of scoping.
- **Minimize invented concepts (boxholder feedback memory):** no new tag, no new frontmatter structure beyond one string key, no new section marker beyond a heading.
- **Shipped precedent:** `src/scripts/migrate/briefing-openers/run.ts:1-25`, a fail-closed plan/apply/verify briefing migration that keeps the stock-template ledger in step. Track 4 copies its shape.

## What already exists

- Briefing fields `src/schemas/briefing.tsx:46-50`: `"key-people"`, `properties`, `body`. No purpose field. **Extend.**
- `compileBriefing` `src/schemas/briefing.tsx:182-203`: emits body markdown then `**Label:** …` records. **Extend** with a `**Purpose:**` line from frontmatter.
- `emitBriefingTag` `src/core/markdoc/emit-tags.ts:151-167`: the only place `purpose`/`correction` are compiled to markdown. **Delete.** Body prose already passes through `emitBodyAsMarkdown`, so a `## Corrections` heading and list need no emitter code.
- `src/core/judgment/situation.ts:20`: `const PURPOSE_BLOCK = /{%\s*purpose\s*%}([\S\s]*?){%\s*\/purpose\s*%}/;` and `situation.ts:66-71` reading the root briefing's purpose as the default judgment situation. **Rewrite** to read the frontmatter key with `readCardFrontmatter` (`src/core/card-io.ts:265`).
- Briefing seed `src/schemas/briefing.tsx:230-240` (`createBriefingTemplate`), hash ledger `src/core/template-stock-hashes.ts:34-41` (`briefing-seed`, one current and four superseded hashes), updated by `pnpm template-stock:update` (`package.json:83`). **Reuse:** the hash ledger is how the installer recognizes an untouched seed; the migration recognizes the seed the same way (`src/scripts/migrate/briefing-openers/plan.ts:133`).
- Capture timeline `src/core/capture/prepare/timeline.ts:206` and `:214`: `parts.push(\`{% silence duration="${gapSeconds}s" /%}\`)` and `parts.push(\`{% image ref="${event.image.ref}" /%}\`)`; images-only session at `:227`. The only producer; `bbx scan-import` writes an empty body (`src/schemas/capture-session.tsx:135-166`). **Change** three lines.
- Body ref tracking: `extractBodyRefs` `src/core/body-refs.ts:316-335` follows tag attributes named `ref`; `extractBodyLinks` `src/core/body-refs.ts:114-126` follows inline markdown links and skips only external URLs. **Reuse:** a markdown link to `attach/photo-001.image.card` is tracked by the second walker, so rename and dangling-ref checks keep working. The frontend resolves `attach/` in links the same way as in the old tag (`src/frontend/src/lib/view-url.ts:176`: *"if `relative` starts with `attach/`, the prefix is resolved"*).
- Frontend components: `src/frontend/src/components/Markdown/BriefingTags.tsx` (59 lines, `Purpose`, `Correction`, `makeBriefingComponents`); `body.tsx:212-245` (`CaptureImage`, `Silence`); registration `body.tsx:265-269`. **Delete.**
- Tag schemas `src/shared/markdoc-config/tags/core.ts:204-224` and `:246-268`; registration `:392-393`, `:397-398`; header comment `:29-39`. **Delete.**
- Migration runner: `src/core/migrations.ts` (append-only `MIGRATIONS`, manifest `_config/migrations.jsonl`), `bbx engine migrate` (`src/core/migration-run.ts`, `src/core/migration-sweep.ts`). Deploy runs `engine migrate --sweep` during activation (`deploy/deploy.sh:843`) and the `box-convergence` schedule retries (`docs/server/deploying.md:28`). **Reuse.**
- Unknown-tag render fallback (slice 2, `src/shared/markdoc-config/scoped.ts`): an unmigrated card shows `{% purpose %}` as muted code and its text below. **Reuse** as the transition rendering.
- Search extraction (`src/core/search/extract/core.ts:210-221`) indexes raw body text and has no tag handling. Nothing to change.

## Prior art (external)

No decision here depends on an external premise. Markdoc frontmatter and markdown links are already in use throughout the box. Skipped.

## Ontology

This plan adds one noun and removes four.

- **purpose** (new frontmatter key on `briefing`): one string, what this box or directory is for. Optional in the schema; the instructions require it at the box root. It is NOT a body section. Read by `compileBriefing` and `resolveSituation`.
- **Corrections section** (convention, not a schema object): the body heading `## Corrections` followed by a bullet list. One bullet is one correction. A trailing sentence `Test: …` says how to check it. Nothing parses it; the compiled briefing carries it as markdown.
- **image card link** (existing noun, a markdown link): `[<label>](attach/<name>.image.card)`. The label is the file stem without `.image.card`, the same label the old `CaptureImage` component computed (`body.tsx:217`).
- **silence line** (convention): the paragraph `— <N>s silence —`, the text the old `Silence` component rendered (`body.tsx:243`).
- Removed: tags `purpose`, `correction`, `image`, `silence` and React components `Purpose`, `Correction`, `CaptureImage`, `Silence`.

## Tracks / scope

### Track 1. Briefing: purpose in frontmatter, corrections as a section

**What.** Add `purpose: z.string().optional()` to the briefing fields. `compileBriefing` emits `**Purpose:** <text>` as the first section when the key is present and non-blank. `resolveSituation` reads the key instead of the regex. The seed template moves the stub into frontmatter. The instructions describe the frontmatter key and the `## Corrections` convention.

**Why.** The two tags exist only to be compiled into AGENTS.md and styled on the card page. A frontmatter string and a markdown heading give the same result with no tag.

**Direction.**

```ts
// src/schemas/briefing.tsx fields
purpose: z.string().optional(),
```

```ts
// compileBriefing: before the body section
const purpose = fields.purpose?.trim() ?? "";
if (purpose !== "") sections.push(`**Purpose:** ${purpose}`);
```

```ts
// situation.ts
const fm = briefing === null ? null : readCardFrontmatter(briefing);
const purpose = typeof fm?.["purpose"] === "string" ? fm["purpose"].trim() : null;
```

Seed (`createBriefingTemplate`):

```
---
type: briefing
purpose: What this box is for.
---
<REACHING_ME_DEFAULT>
```

Instructions replace the "Body tags" list (`briefing.tsx:104-112`) with:

- `purpose:` (frontmatter) — one sentence or short paragraph, what this box or directory is for. Required at the box root; optional in directory briefings.
- `## Corrections` (body section) — one bullet per instruction that overrides default agent behavior, added after an observed mistake. End a bullet with `Test: …` when there is a way to check the correction is followed.

The sentences at `briefing.tsx:95-97` ("write their answer into `{% purpose %}`") and `:129-130` change to match. `docs/notifications.md:111` keeps its meaning and needs no change (it says "the root briefing's purpose").

**Vocabulary lock-ins.** Frontmatter key `purpose`; heading text `## Corrections`; trailing sentence prefix `Test:`.

**First implementation chunk.** Schema field, `compileBriefing`, `situation.ts`, seed template, `pnpm template-stock:update`, instructions text, and the doctests `test/schemas.briefing-compile.doctest.md`, `test/core/agent-guide/guide/reaching.doctest.md:31`, `test/cli/commands/judge/command.doctest.md:229`. The emitter case stays until Track 3 so the chunk is green on its own.

### Track 2. Capture timeline: link and text

**What.** `buildTranscriptMarkdown` writes `[<stem>](<ref>)` for a photo and `— <N>s silence —` for a gap.

**Why.** The markers exist to be rendered by two small components. A link renders through the card-link component already used for every other body link, and the silence text is what the component rendered anyway.

**Direction.**

```ts
// timeline.ts:206
parts.push(`— ${gapSeconds}s silence —`);
// timeline.ts:214 and :227
parts.push(imageLink(event.image.ref));
// helper in timeline.ts
function imageLink(ref: string): string {
  const stem = ref.replace(/^attach\//, "").replace(/\.image\.card$/, "");
  return `[${stem}](${ref})`;
}
```

The capture-session instructions (`capture-session.tsx:10-12, 48, 72-74`) and `docs/box/what-you-could-do.md:57` describe the new shapes. The fixture `test/fixtures/process-captures/stock.procedure.card:285-286` is updated.

**Vocabulary lock-ins.** None new; markdown link and plain text.

**First implementation chunk.** The three lines, the helper, `test/core/capture/prepare.doctest.md:173-184` updated to the new body, instructions and docs.

### Track 3. Remove the tags

**What.** Delete the four schemas and their registrations from `core.ts`, the header comment lines `29-39`, `emitBriefingTag` and its dispatch line (`emit-tags.ts:72`), `BriefingTags.tsx`, `CaptureImage` and `Silence` in `body.tsx`, and the four component registrations.

**Why.** With Tracks 1 and 2 in, nothing produces the tags. A tag with no producer and no renderer is a trap for an author who finds it in old docs.

**Direction.** Deletions only. `test/core/markdoc/emit/*.doctest.md` loses any `purpose`/`correction` example; `test/schemas.doctest.md` or a tag-table doctest asserts the four names are absent from `markdocConfig.tags` and that `{% purpose %}` in a memo body is `Undefined tag`.

**Vocabulary lock-ins.** None.

**First implementation chunk.** The whole track is one commit, after Tracks 1 and 2.

### Track 4. Migration `body-tags-2026-10`

**What.** A script migration at `src/scripts/migrate/body-tags/{plan.ts,run.ts}`, registered last in `MIGRATIONS`, that converts every live card in a box.

**Why.** Six production boxes and five local boxes hold the old shape. After Track 3 those cards fail validation. The conversion is deterministic text rewriting, so it is a script, not a procedure (`.claude/skills/bbx-migration/SKILL.md`, "Which kind").

**Direction.** `plan.ts` is pure: `planBodyTagRewrites(cards: ReadonlyArray<{path, text}>): { writes: Array<{path, text}>; failures: Array<{path, reason}> }`.

Per card (any `*.card` under the box root, skipping `.git`, `node_modules`, and `_config/_template-updates/`):

1. `{% image ref="X" /%}` (self-closing, any whitespace) becomes `[<stem of X>](X)`. Applies to every card type; one production book card uses it by hand.
2. `{% silence duration="D" /%}` becomes `— D silence —`.
3. In `*.briefing.card` only:
   - One `{% purpose %}…{% /purpose %}` block: the trimmed inner text becomes frontmatter `purpose`. The block is removed from the body. Two blocks, or a block plus an existing `purpose:` key with different text, is a failure.
   - Each `{% correction [test="T"] %}…{% /correction %}` block is removed from the body and collected. If any were collected, the body ends with `## Corrections` and one bullet per block: the inner text with blank lines collapsed to one space, then ` Test: T` when the attribute is present. A body that already has a `## Corrections` heading is a failure (none exists today).
4. `purpose` or `correction` in a non-briefing card is a failure.
5. A card with none of the four tags is skipped (idempotent). Frontmatter is edited as a YAML document (`parseDocument` from `yaml`, the way `briefing-openers/plan.ts:79-82` does) so existing keys, order, and comments survive; `purpose` is added as the first key after `type` when present.

`run.ts` follows `briefing-openers/run.ts`: plan the whole box, exit 1 with every failure listed and nothing written; `--apply` writes; the root briefing whose pre-image hash is in `TEMPLATE_STOCK_HASHES["briefing-seed"]` (current or superseded) goes through `recordAutomatedTemplateRewrite`; `--verify` re-scans for any of the four tags and exits 1 if one remains. Soft exit 2 is not used, for the reason the precedent gives (`run.ts:8-11`).

Tag matching is by regex on the raw body, as `situation.ts` does today, because the Markdoc parser would need the tags to still be declared to give attribute values; the regexes accept the exact shapes the two producers and the instructions ever wrote.

**Vocabulary lock-ins.** Manifest name `body-tags-2026-10`.

**First implementation chunk.** `plan.ts` with its doctest (`test/scripts/migrate/body-tags.doctest.md`): one briefing with purpose and two corrections, one capture body, one book card with an image tag, one memo with a stray `{% purpose %}` (failure), one already-migrated briefing (skipped), one briefing with two purpose blocks (failure). Then `run.ts`, the registry entry with a comment, and a doctest that runs it against a temp box and checks the manifest entry and `bbx validate` exit 0.

## Could this be simpler?

**Simplest version:** Tracks 1 to 3 with no migration; fix the cards by hand. It fails on the 19 capture cards with 60 or so generated markers in production, which no one should edit by hand, and leaves every box failing validation until someone acts.

**Also considered:** keep the four tags registered but mark them deprecated, so old cards keep validating. That is two ways to write one thing (principle 8, "One way to do each thing") and leaves the scoping question open. Rejected.

**Also considered:** make the migration a Markdoc AST walk instead of regexes. The AST would need the schemas kept alive inside the migration; a regex on two self-closing and two block shapes is shorter and checkable in a doctest. Rejected.

What the chosen plan buys over the simplest version is one deterministic pass, fail-closed, that the deploy already runs.

## Subplans

none

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Briefing with `purpose:` key blank or missing at the box root | no (planned: compile doctest) | `resolveSituation` returns the "no purpose statement" source as today | clear (the judge says why) |
| Migration meets two purpose blocks or a conflicting key | planned doctest | fail closed, exit 1, nothing written | clear |
| Migration meets a correction inside a nested tag or with an unusual attribute quoting | planned doctest for `test='…'` single quotes; others | regex misses it; the tag stays; `--verify` exits 1 and `bbx validate` reports `Undefined tag` | clear |
| Capture link stem collides with another file name in the body | n/a | a markdown link label is display text only | n/a |
| Image card renamed after the transcript was written | existing link-ref tests | `extractBodyLinks` tracks it like any body link | clear (dangling ref) |
| Unmigrated box after engine deploy, before the sweep reaches it | slice 2 unknown-tag doctest | renders authored tag text; `bbx validate` fails | clear |
| Stock seed hash not updated after the template change | `test/core/box/...` template-stock doctest fails | `pnpm template-stock:update` | clear (test) |
| Judge default situation changes when a box's purpose moves to frontmatter | planned: judge doctest reads frontmatter | same text, new source | n/a |

No critical gap.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field:** ADDRESSED. There is no tag to choose; a stray `{% purpose %}` is `Undefined tag` (Track 3 doctest).
- **Stale ref:** ADDRESSED. Image links are ordinary body links (`body-refs.ts:114`).
- **Two agents touching the same card:** not changed by this plan; the migration runs under the deploy's maintenance window (`deploy.sh:843`, `--within-maintenance`).
- **Hand-edit drift:** ADDRESSED for purpose (a frontmatter string has one shape). For corrections, a person may write `## Correction` or a numbered list; nothing parses the section, so the only consequence is a heading that differs from the instructions. Accepted.
- **Fabricated free-form value:** the `Test:` sentence is optional and plain text, as the `test` attribute was. No change.
- **Validation error UX:** `Undefined tag 'purpose'` with file and line, the existing message.
- **Partial migration / transition state:** ADDRESSED. The migration writes all or nothing per box; between engine deploy and sweep, cards render with the unknown-tag fallback and fail validation loudly.

## NOT in scope

- Scoping other core tags (`quote`, `source`, `redacted`, `task`, `todo`, `see-also`, footnotes). They are general-purpose; the slice 2 question was only about these four.
- A structured `corrections` frontmatter list. Rejected in the design discussion; prose belongs in the body.
- Rendering the `## Corrections` section specially on the card page. Nothing parses it; a heading and list render as markdown.
- Changing `key-people` and `properties`. They stay frontmatter as today.
- A deferred legacy-removal issue. The migration leaves no tolerance code behind: after Track 3 nothing reads the old shape, so there is nothing to remove later. Noted here so the omission is deliberate (`docs/cards/migrations.md`, step 7).
- Refreshing the stale briefing knowledge audits that name `key-person`, `property`, `project-phase` beyond the entries this plan touches. The four entries at `knowledge-audits.yaml:5147-5222` are rewritten because they describe the tags being removed; the comment at `:5137-5145` is corrected in the same edit.
- The local boxes other than the test1 clone. The finish step runs `bbx engine migrate` on `~/src/boxes/*` as part of landing, not this plan's implementation.

## Open design questions

None. The heading text `## Corrections` and the `Test:` prefix are settled above.

## Knowledge audits

- Rewrite `briefing-tag-vocabulary` (`knowledge-audits.yaml:5147-5158`) as `briefing-purpose-frontmatter`: "Where does a box's purpose statement live and how do you change it?" Correct answer names the `purpose:` frontmatter key on the root briefing.
- Rewrite `briefing-correction-test` (`:5211-5222`) as `briefing-corrections-section`: "An agent keeps archiving items before reading them. Where do you record the rule and how do you say how to check it?" Correct answer names `## Corrections`, a bullet, and a `Test:` sentence; wrong answer mentions `{% correction`.
- Rewrite `briefing-prose-vs-tag` (`:5197-5209`) to ask about plain headings versus frontmatter.
- Fix `briefing-key-person-ref` (`:5164-5177`) to describe the frontmatter `key-people` list, which is what exists.
- Update the fixture body at `:7519-7528`.
- New `capture-transcript-markers`: "What does a photo look like in a capture transcript body, and what does a pause look like?" Correct answer: a markdown link to the image card and a `— Ns silence —` line.
- Run: `pnpm knowledge-audit run --box ~/src/box-worktrees/plugins-planning/test1 --filter briefing-` and `--filter capture-transcript`; record the status comments.

## What will hold this after it ships

- Doctests reach everything: `compileBriefing` and `resolveSituation` are pure given a card text; `buildTranscriptMarkdown` is pure; `planBodyTagRewrites` is pure. No new test tier, no mock.
- `test/plugins.doctest.md` and the slice 2 scoped-tags doctests already assert that an undeclared tag is `Undefined tag`; Track 3 adds the four names to that check.
- The template-stock hash doctest fails if the seed changes without `pnpm template-stock:update`.

## Implementation order

1. Track 1 (briefing frontmatter and instructions, emitter case kept). Commit.
2. Track 2 (timeline). Commit.
3. Track 4 `plan.ts` and doctest; `run.ts`, registry entry, run doctest. Commit. Run against the test1 clone (`~/src/box-worktrees/plugins-planning/test1`): plan, apply, verify, `bbx validate`.
4. Track 3 (delete tags, components, emitter; tag-absence doctest). Commit. Re-run `bbx validate` on the migrated clone.
5. Docs and audits: `docs/box/what-you-could-do.md`, a `body-tags-2026-10` section in `docs/cards/migrations.md` after the `briefing-openers-2026-10` one (`:320-341`), knowledge audits run. Commit.
6. Cross-model diff review, fixes, CODING_FEEDBACK entries.

## Rollout shape

**Tests first.** `test/schemas.briefing-compile.doctest.md` gains a frontmatter purpose example and loses the tag example; `test/core/capture/prepare.doctest.md` expects the link and text; `test/scripts/migrate/body-tags.doctest.md` covers the seven plan cases above and a run against a temp box; `test/core/judgment/...` or the judge command doctest reads purpose from frontmatter; a tag-table doctest asserts the four names are gone. Done when these pass with `pnpm test:changed`, typecheck, lint, layout check.

**Migration.** Script, atomic per box, registered as `body-tags-2026-10`. Deploy runs it in the maintenance sweep (`deploy/deploy.sh:843`); the `box-convergence` schedule retries a box the deploy could not finish (`docs/server/deploying.md:28`). Counts on 2026-10-10:

Six production boxes in total: 23 briefing cards carrying the tags, 8 correction blocks, 19 capture-session cards (about 60 image markers and 3 silence markers), and 1 hand-authored book card using `{% image %}`. The largest single box holds 13 of the capture cards.

Local: five boxes under `~/src/boxes/` each have one briefing card with tags and no capture cards. The finish step runs `bbx engine migrate` on each after the merge. Generated docs under a box's `docs/generated/` that mention the old tags are regenerated by the migration CLI's guidance refresh (`docs/cards/migrations.md`, step 6).

**Verify after deploy.** `bbx engine migrate --status --json` per production box shows `body-tags-2026-10` applied; `run.ts --verify` exits 0; `bbx validate` exit 0 on each box.
