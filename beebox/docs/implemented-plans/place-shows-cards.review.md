---
title: "A place shows the person's cards: plan review"
---
# Plan review — place-shows-cards

Reviewer: codex gpt-6-sol, effort high, 2026-10-11. Round 1 findings verbatim below, then the planner's adjudication.

## Ranked findings

The boxholder authorized all three experiences: an agent-written landmark body, an “Also here” fallback, and summary lines. The smallest sound version keeps those three and cuts or corrects the extra machinery below.

1. **The agent has no reliable trigger to maintain the body.** Track C says the agent updates it whenever it changes what a place holds ([plan §Right place, right time](place-shows-cards.md), [§Track C](place-shows-cards.md)). But the always-loaded guide tells agents to read landmark instructions *before editing a landmark*, not when saving an ordinary card ([guide.md](../../src/core/agent-guide/guide.md)); the type doc is on demand ([guidance-surfaces.ts](../../src/core/box/guidance-surfaces.ts)). An agent can save a loan without encountering the update rule. A journey already records the analogous missed root-landmark opener edit ([C report](../../test/user-stories/journeys/C-reconnecting/reports/2026-10-09.md)). **Smallest remedy:** put the card-change trigger in always-loaded guidance and test a turn that edits an ordinary card without first opening its landmark. A knowledge quiz about the landmark type alone does not test this path.

2. **The proposed stale sentence cannot truthfully be computed from mtimes.** Track C calls the landmark file’s mtime `bodyWrittenMs` ([plan §Track C](place-shows-cards.md)). Concrete state: write the body Monday; change a loan Tuesday; edit only `navigation.openers` Wednesday. The landmark mtime is now Wednesday, so `changedSince` becomes zero although the body predates the loan. Checkout or sync can likewise reset file mtimes without changing when the prose was written. **Smallest remedy:** omit the stale sentence from this version. If the product requires a dependable freshness claim, recording a body revision or write time is **human decision required** because it adds durable state.

3. **The tile-summary path would silently lose summaries as specified.** Track B says `cardIdentity` will call `cardParts` on cached frontmatter ([plan §Track B](place-shows-cards.md)). `cardParts` is private and validates its fields against a schema requiring `type` ([loader-registry.ts](../../src/core/loader-registry.ts), [cards/schema.ts](../../src/cards/schema.ts)). The cached reader returns raw YAML ([card-io.ts](../../src/core/card-io.ts)); normal loading injects `type` separately ([card-io.ts](../../src/core/card-io.ts)). A valid `loan` without an on-disk `type:` would therefore fall back to its base summary, leaving `detail` absent while only logging a warning. **Smallest remedy:** use the exported `summarize` path with validated fields, injecting the filename type as normal loading does; test a valid box-authored card with no on-disk `type:`.

4. **“Nothing here yet” will still assert false emptiness.** Track A says the copy appears only when the place holds no cards ([plan §When it goes wrong](place-shows-cards.md), [§Track A](place-shows-cards.md)). The walk skips a card with an unregistered type and stops at nested landmarks; background cards are deliberately excluded ([prominence-index.ts](../../src/core/landmark/prominence-index.ts), [prominence-index.ts](../../src/core/landmark/prominence-index.ts)). A folder holding only its briefing still gets the current “Nothing here yet” copy ([PlaceView/view.tsx](../../src/frontend/src/components/PlaceView/view.tsx)). **Smallest remedy:** say “No cards to show here yet” when the visible sections are empty; do not claim the folder is empty.

5. **The Browse count changes meaning at nested landmarks.** Track A promises a recursive count including nested places, derived from the pruned walk ([plan §Track A](place-shows-cards.md)). That walk stops when it finds a child landmark ([prominence-index.ts](../../src/core/landmark/prominence-index.ts)); today’s count walks recursively ([status.ts](../../src/webapp/trpc/routers/status.ts)). A parent containing only a nested place with five cards would show zero under the proposed calculation. **Smallest remedy:** leave the Browse count change outside these three experiences, or specify and implement a separate recursive count with an accurate label.

6. **Background-defaulting `briefing` hides a person-readable card in Browse.** The plan calls briefings agent guidance and accepts Browse folding as a cost ([plan §Track A](place-shows-cards.md), [§Stated preferences](place-shows-cards.md)). Its schema explicitly says the person reads the briefing as their own page ([briefing.tsx](../../src/schemas/briefing.tsx)). With a primary sibling, Browse moves a background briefing into the dimmed “more” tier ([browse-fold.ts](../../src/shared/browse-fold.ts)). Recent chats use their own session enumeration, while search eligibility is separate from prominence; neither offsets this Browse change. **Smallest remedy:** decide explicitly whether briefing should become background globally or be excluded only from the fallback. That visibility choice is **human decision required**.

7. **“Newest first” is an unstable promise.** Track A orders the fallback by filesystem mtime ([plan §Track A](place-shows-cards.md)). The existing expand sorter uses mtime for “modified” order ([resolve/core.ts](../../src/core/landmark/resolve/core.ts)), but it does not establish a durable card-edit chronology. After checkout or sync, unchanged cards can acquire new mtimes, changing which ten appear. **Smallest remedy:** describe and test this as local “recently modified” ordering with a deterministic path tie-break, or use a durable ordering source. Durable chronology is **human decision required** if “newest” must survive sync.

8. **The embed direction risks printing the title twice.** Track B asks `MarkdownCardView` to render title, detail, body, then fields ([plan §Track B](place-shows-cards.md)). Embed mode already puts the common `title` field in the front field block ([card-field-faces.ts](../../src/frontend/src/lib/card-field-faces.ts)). Moving that block after the body without removing `title` yields a second title there. **Smallest remedy:** take `title` out of the embed field block when rendering its dedicated heading; test the full rendered order.

9. **Two failure-mode claims overstate existing safeguards.** Landmark cards have `searchable: false` ([landmark.ts](../../src/schemas/landmark.ts)); search refresh drops non-searchable types before the `contains` sidecar observes them ([search/refresh/core.ts](../../src/core/search/refresh/core.ts)). Thus the plan’s one-time landmark `contains:` staleness and wakeup backfill are not established ([plan §Failure modes](place-shows-cards.md)). Separately, validation does inspect body links, but a broken ref is a **warning**, not a guarantee that the landing page remains correct ([card-lint/core/lint-cards.ts](../../src/core/card-lint/core/lint-cards.ts), [plan §Agent-flow edge cases](place-shows-cards.md)). **Smallest remedy:** remove the `contains` transition and describe broken-link validation as warning-only.

**Single most important change:** make landmark-body maintenance reachable from an ordinary card-writing turn, then verify that actual agent flow. Otherwise the authorized main experience can remain empty while all schema and rendering tests pass.

Additional files opened beyond the first-hop list: `beebox/src/core/lint-prominence/core.ts`, `beebox/src/shared/browse-fold.ts`, `beebox/src/frontend/src/pages/browse/components/BrowseSidebarBody/BrowseSidebarList.tsx`, `beebox/src/core/agent-guide/guide.md`, `beebox/src/core/box/guidance-surfaces.ts`, `beebox/src/core/chat/session/landmark-context.ts`, `beebox/src/core/search/refresh/core.ts`, `beebox/src/core/card-lint/core/lint-cards.ts`, `beebox/src/webapp/trpc/routers/landmarks/router.ts`, `beebox/src/frontend/src/components/themes/ThemedFileCard/view/ThemedFileCard.tsx`, `beebox/src/frontend/src/components/PersonView/view.tsx`, `beebox/src/core/chat/session/list/core.ts`, `beebox/docs/landmarks.md`, and the 2026-10-09 A-lending, B-inventory, C-reconnecting, D-chemistry second-walk, and F-newcomer journey reports.
## Adjudication (round 1)

All nine verified against source and accepted.

1. Trigger: accepted. The rule moves to the always-loaded guide's LANDMARKS section; audit `landmark-body-after-card-save` asks from the card-save situation.
2. Stale line: accepted; cut. A dependable freshness line needs recorded state; listed in NOT in scope.
3. `cardParts` / `type`: accepted. Tiles use the exported `summarize` with `type` injected from the filename; a doctest covers a card with no on-disk `type:`.
4. Empty copy: accepted. "No cards to show here yet."
5. Browse count: accepted; cut from this plan, stays in the counts issue (not in the plan's `issues:`).
6. Briefing: accepted. `briefing` stays ordinary and appears in "Also here"; no human decision needed, because the schema already calls it the person's page.
7. Ordering: accepted. Described as "recently changed" with a path tie-break.
8. Embed title: accepted. `title` leaves the embed field block.
9. Overstated safeguards: accepted. The `contains` row is removed (landmarks are not searchable); body-link validation described as warning-only.

## Round 2 (codex gpt-6-sol)

Round-1 findings 2-9 verified resolved; finding 1 partly resolved. Three fresh findings, all verified and accepted:

1. Existing bodyless places would never get a body under an "update if untrue" rule. Fixed: the guide line says to write a summary when the landmark has none; Rollout adds a real-agent check of a card-save turn against a bodyless place and against a place with a body.
2. Card-page `detail` would be dropped in `useFileData` (`components/file-view-data.ts:173`) and `FileData` has no field. Fixed: Track B carries `detail` through both and uses the exported `summarize`.
3. A capped group would show two overflow counts (`LandmarkSection.tsx:201`). Fixed: `LandmarkGroup` gains `onMore`, which turns its existing "+N more" into the Browse action.

## Diff review (codex gpt-6-sol), 2026-10-11

Round 1 on `git diff main...HEAD`: three findings, all verified and fixed in `ffaca8cb9`.

1. Root-landmark repair (`installRootLandmark`) replaced an inert root landmark whole, dropping an agent-written body. Fixed: the body is kept (a legacy XML body still goes); doctest in `defaults.landmark.doctest.md`.
2. A tile summarized a card whose written `type:` disagrees with its filename as the filename's type. Fixed: no summary line for a mismatch; doctest case `Mislabeled.loan.card`.
3. The "Also here" group and an author-named expand group "Also here" shared a React key. Fixed: keys include the group's kind.

Round 2 (verification only): 2 and 3 hold. 1 holds for the reported case. Residual, accepted: a root landmark whose frontmatter does not parse (for example `navigation: 42`) still gets stock frontmatter in place of its own, as on main; its body is now kept. Rare, and not a regression.
