# Plan Engineering Review — retire-type-specific-core-tags

Reviewer: codex gpt-6-sol, effort high, 2026-10-10 (`scratch/cross-model/2026-10-10T22-01-22-647Z-codex.md`). Adjudicated by the planning session. Each finding was checked against the source before the plan changed.

## Findings and adjudication

### Validation does not block on a leftover tag
**Location in plan:** Design "When it goes wrong", Rollout shape.
**Citation:** `src/core/body-markdoc-lint.ts:35-37` "one warning-severity `LintIssue` per violation".
**Issue:** The plan used `bbx validate` exit 0 as the proof that migration finished; body Markdoc findings are warnings, so validate exits 0 with the tag still present.
**Adjudication:** Holds. The plan now names the migration's `--verify` scan as the gate and treats the validate line as a warning. Changing lint severity is not in scope.

### Purpose leaves the search document
**Citation:** `src/core/search/extract/core.ts:229` `foldFields` has no `briefing` case; `docs-gen/compile/core.ts:117` compiles only the root briefing.
**Adjudication:** Holds. Track 1 gains a `briefing` fold of `purpose` with a doctest on a directory briefing.

### "All or nothing" overstated
**Citation:** `briefing-openers/run.ts:99` writes file by file; `migration-sweep.ts:235` does not restore on failure.
**Adjudication:** Holds as a wording defect. The plan now says planning is all-or-nothing, writes are sequential, and a rerun completes a half-converted box because converted cards are skipped. A box-wide atomic write is not added (`human decision required` was offered; the lean is no, the rerun covers it).

### Regex location rejected an AST for a false reason; fenced examples
**Citation:** `body-refs.ts:306-335` reads tag attributes from `Markdoc.parse` with no schema. Scratch parse 2026-10-10: tags inside a code fence are still tag nodes; block tags report `[openStart, openEnd, closeStart, closeEnd]`.
**Adjudication:** Holds. Track 4 now locates tags with `Markdoc.parse` and fails closed on a tag inside a fence, a list item (for purpose/correction), or another tag. Test list extended: single quotes, two-paragraph correction, list item, fence.

### Stock seed needs the exact current template
**Citation:** `template-update.ts:86-91` returns early with no ledger hash; `briefing-openers/plan.ts:170-172` replaces a recognized seed with `createBriefingTemplate()`.
**Adjudication:** Holds. Track 4 copies the precedent; doctest covers tracked, untracked, and hand-edited root briefings.

### `Test:` prefix is new vocabulary
**Adjudication:** Accepted. The boxholder agreed to a plain section, not a prefix. The instructions now ask the author to say how to check the correction in the same bullet, with no prescribed words; the migration still writes a converted `test` attribute as `Test: <text>` so nothing is lost. Audit wording adjusted.

### Link label wording (check 2)
**Adjudication:** Holds. The walkthrough said the link shows the image card's label; it shows the authored stem, which is what the old chip showed. Corrected.

## Things checked and found clean
- No reader of the four tags beyond the named briefing, judgment, capture, emitter, and renderer paths (reviewer check 1).
- `attach/` markdown links are extracted, rewritten by `bbx mv`, lint-checked, and resolved by the frontend the same as the old `ref` attribute (reviewer check 2, `body-refs.ts:55`, `rewrite-card-refs/core.ts:204`, `lint-cards.ts:188`, `view-url.ts:170`).
- Compiled briefing order `**Purpose:**`, body, records has no dependency on `emitBriefingTag` (check 5).
- Generated image and silence markers are single-line self-closing tags (check 3).

# Implementation review — round 1

Reviewer: codex gpt-6-sol, effort high, 2026-10-10 (`scratch/cross-model/2026-10-10T22-21-16-280Z-codex.md`), on commits 0c2b17d70, 7a689a9f6, c851f0f58. Six findings, all verified against the source; all fixed in the migration before round 2.

| Finding | Verdict | Fix |
|---|---|---|
| Block-form `{% image %}…{% /image %}` converts to a link plus a dangling close tag, and `--verify` skips it because the prefilter matches opening tags only | Holds | Planner fails closed on an image/silence node with a 4-entry line span; the prefilter in plan and verify matches closing tags too |
| The source-tag regex cannot match a `%` inside an attribute, so a decoy literal tag on the same line is replaced instead and only verify notices, after the write | Holds | Regex allows `%` inside double-quoted values; each matched source string is re-parsed and must yield one tag node with the planned tag and attributes, or the card fails before any write |
| A ref with a space or bracket becomes text that is not a markdown link | Holds | Planner fails closed on whitespace, `]`, `(`, `)`, `<`, `>` in the ref; generated capture names never contain them |
| An apply interrupted between writing the seed and updating the ledger leaves a stale ledger that a rerun does not repair | Holds | Apply reconciles the ledger when the root briefing equals the current seed and the ledger records an older stock hash |
| `test=42` parses as a number and the check is dropped | Holds | Fail closed on a present non-string `test` |
| An existing `purpose: null` key makes `doc.set` update in place and the reorder moves the wrong pair | Holds | Set in place when the key exists; reorder only a newly added pair |

Plan-record corrections from the same review: single-quoted attribute values are a parse error in Markdoc, so the migration fails closed on them (the plan had said they parse normally); `bbx validate` warns on a leftover tag and does not fail, so the plan's remaining "fails validation" wording was corrected.

Found clean by the reviewer: consecutive photo tags, two replacements on one line, purpose removal at body boundaries, briefing compile order, missing, blank, and stub purpose handling, and no other producer or reader of the four tags in `src/`.

# Implementation review — round 2

Reviewer: codex gpt-6-sol, effort high, 2026-10-10 (`scratch/cross-model/2026-10-10T22-31-30-867Z-codex.md`), verifying the six fixes in bb16fab77. Five hold. Two residuals, both fixed in the following commit:

- **Comment on a replaced `purpose: null`** followed the new value (`purpose: A # deliberately unset`). The comment described the absence, so the planner now drops the trailing comment when it sets an existing null in place; a doctest shows the result.
- **Identical decoy in a code span** before the real tag: the re-parse check accepted the literal first. Markdoc gives no column offsets, so the planner now fails closed whenever an inline code span in the card contains a retired tag; the doctest that showed a decoy being left alone now shows the card failing with "quoted in a code span". The `%`-in-ref case keeps its own test.

Rounds stop here (two full rounds, residuals fixed and covered by doctests). Residual risk accepted: a card whose only retired-tag text is in a fenced block with `process=false` is not a tag node and is left untouched by design; none exists in production (grep 2026-10-10).
