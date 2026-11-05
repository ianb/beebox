---
title: "Select card and chat content from the top bar"
status: implemented
workstream: point-to-comment
issues:
  - ../../../issues/features/2026-11-01-point-to-comment.md
---
# Select card and chat content from the top bar

Move the Select mode from each companion card to one icon in the box's top bar. Use that mode to attach a card or chat-message part to the ordinary chat draft. Remove the old text-selection `+` path; ordinary text selection remains for copy.

**Issues addressed:** `2026-11-01-point-to-comment`, reopened after the first implementation put the control on the card and left text-selection attachment active. The related `2026-10-09-mobile-long-press-paragraph-to-comment` remains a separate proposal; the explicit mode may make its long press unnecessary.

## Design

### Situations

- When I notice a paragraph in a card beside chat, I want to point at it from a mode I can find at the top, so I can say what I think in chat.
- When I see a line in a chat message, I want to point at it the same way, so the box knows which part I mean.
- When I am reading or copying text, I want selection and links to work normally, so I do not attach a comment by accident.

### Right place, right time

| Situation | Behavior | Surface and attention |
|---|---|---|
| Card or chat visible with a composer | One icon-only Select toggle in the global top bar; hover previews a block and click attaches it | Box app bar, quiet and findable |
| Touch on card or chat | Tap previews the block; a nearby `+` confirms attachment | Content under the finger, deliberate |
| Ordinary reading | Mode starts off; text can be copied but no attachment `+` appears | No extra chrome |

### Spirit

“Feedback is everywhere, and it's not all commands” in `docs/architecture/spirit.md` supports pointing to a thing and speaking in the existing open chat input. “You should be able to see the gears” risks a vague reference; the existing selection pill, quote, source, and inline token remain visible and removable.

### Trust

Desktop click or touch confirmation adds a reference to the unsent draft. Sending remains a separate person action. The picker never sends a message or authorizes an agent action.

### When it goes wrong or does nothing

If a block has no meaningful text, alt, caption, or source, it is not picked. If the wrong block enters the draft, the person removes its existing selection pill. A touch pick whose content changes before confirmation is discarded. Escape or pressing the top-bar icon again exits. The icon is absent where no chat composer is mounted; selecting the app's menus and controls is outside this pass.

### Walkthrough

The person opens a card beside chat, presses the pointer-and-target icon in the top bar, hovers a paragraph to see its outline, and clicks it. The ordinary chat composer gains the selection pill and `[selection#N]`. They can then click a paragraph in a chat message and get a second pill with a chat source. On a phone, tapping a block first shows its outline and a nearby `+`; that button adds the pill. Leaving the mode restores links and ordinary text selection, which no longer opens an attachment `+`.

## Smallest fix and budget

Move the mode state to a box-shell provider, render an icon button in `AppNav`, and let the existing card and transcript `SelectionCapture` wrappers consume that state. Remove their text-selection attachment branch. Estimate 300–550 changed source/test lines; the issue and a short user-facing exhibit are additional authored material, with no generated output. A global DOM capture layer would reach more app surfaces but lose the existing card/chat source boundaries and add more machinery than this scope needs. Total estimate stays below 2,000 changed lines.

## Stated preferences this plan trades against

The boxholder said, “It should go in the top toolbar, and you can comment on anything basically,” then narrowed this pass to “Card content and chats for now.” They also said “get rid of select-to-comment, and only use the button.” That removes the text-selection attachment `+` while keeping native selection for copy. `beebox/AGENTS.md:9` says “Work only on the requested problem”; this excludes menus, controls, and a new comment store. The app-bar warning at `src/frontend/src/components/AppNav/nav.tsx:21-26` says adding width to its right group takes room from the place label, so the button must be icon-only and checked at phone width.

## What already exists

- `src/frontend/src/main/app-shell.tsx:130-139`: `AppNav` sits above `<main>`, which holds the conversation shell and route. A provider can reach both without moving the bar.
- `src/frontend/src/main/app-shell.tsx:153-157`: `BoxShellProviders` already shares the conversation and card-selection contexts with the bar and content. Add one ephemeral mode context here, preserving child identity.
- `src/frontend/src/components/AppNav/nav.tsx:129-135`: `AppBarChipSlot`, badges, and profile fill the right group. Add a compact icon with an accessible name and `aria-pressed`.
- `src/frontend/src/components/chat/workspace/WorkspaceCanvas/view.tsx:33-80`: per-card `PointModeBar` and `pointMode` are the misplaced control and state; remove them.
- `src/frontend/src/components/FileView/view.tsx:237-250`: `FileView` already turns a capture into `{ ref, text, position }` for a card; reuse this path in companion and routed card views with a chat sink.
- `src/frontend/src/components/chat/everywhere/InteractiveChat/TranscriptSelection.tsx:16-27`: the transcript has its own `SelectionCapture` and sends `{ ref: null, text, position }`; let it use global mode too.
- `src/frontend/src/components/SelectionCapture.tsx:195-225`: the old text-selection path creates a floating `+` even when mode is off; remove that path. Point click currently suppresses events before checking nested-root ownership. Touch revalidation is hard-coded to the document extractor.
- `src/frontend/src/lib/selection/position.ts:183-228`: semantic block picking and visual descriptions already exist. Chat points need the existing transcript speaker locator instead of a document paragraph locator.

## Prior art (external)

No external premise controls this change. The boxholder's correction and the shipped box selection format decide the flow. No external design is adopted.

## Ontology

- **Select mode:** one ephemeral per-box browser state, on or off; it does not store comments.
- **Target:** a visible semantic block inside a card or chat message. It produces one existing `AddSelectionInput`.
- **Selection:** existing `{ ref, text, position }` chat attachment (`src/frontend/src/lib/selection/position.ts:36-47`); card targets use a file ref, chat targets use `null` and a chat/speaker position.
- **Draft:** the existing chat composer and selection pills; no new input or storage format.

## Tracks / scope

### Track 1: Global control and state

Add a small mode provider under `BoxShellProviders`, shared by `AppNav`, `FileView`, and `TranscriptSelection`. `AppNav` renders one icon-only pointer-and-target button with accessible Select/Done selecting names, `aria-pressed`, and a clear active style. Remove the per-card bar/state. Keep mode active across supported card/chat navigation, and turn it off on routes where the conversation shell is absent. The provider coordinates one provisional touch pick at a time: a new pick cancels the prior one, and mode exit or hiding/changing its source cancels it. First chunk: provider and top-bar wiring with a phone-width fit check.

### Track 2: Card and chat capture

Feed the global mode to every eligible `FileView` and to `TranscriptSelection`. Check innermost capture-root ownership before point hover or click suppression. Pass the selection receiver into recursive inline embeds so a card inside a card inside chat keeps its own file ref. Give each root one point extractor used for preview, click capture, and touch revalidation; the transcript variant keeps the semantic block quote but replaces its position with the speaker locator. Reject control hits before finding a semantic block, while allowing a link in content to pick its enclosing block; do not reject an entire transcript because its wrapper has `data-bbx-scan=exclude`. Keep visual descriptions; opaque PDFs and native UI are not targets. Desktop hover outlines and click attaches immediately; touch tap outlines and `+` confirms. First chunk: source routing and representative card/chat tests.

### Track 3: Remove text-selection attachment

Remove the text-selection refresh/`+` branch from `SelectionCapture` and its callers, while leaving native browser text selection alone when mode is off. The top-bar toggle is the only entry to point selection. First chunk: a regression test selecting text outside mode and seeing no attachment `+`.

## Could this be simpler?

Moving only the button to `AppNav` is smaller, but the current `WorkspaceCard` owns the state and only sends it to companion documents (`WorkspaceCanvas/view.tsx:49-63`); a top icon would leave chat messages and other card views unchanged. The shared state and transcript wiring are the minimum needed for the boxholder's two target surfaces. A whole-page event interceptor is broader but cannot automatically preserve the card versus chat source ref.

## Subplans

None. The source and destination are already in the frontend.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| The icon squeezes the place label off a 375px phone bar | Browser check planned | Compact icon-only size; adjust placement if needed | Visible |
| Clicking an embedded card attaches it as chat text | Test planned | Innermost capture root owns the point | Silent if missed |
| Clicking card B embedded within card A in chat attaches A or chat text | Test planned | Recursive embeds receive the selection sink and innermost root handles the click | Silent if missed |
| A chat quote is labeled as a document paragraph | Test planned | Chat point extractor uses transcript speaker position | Silent if missed |
| A touch chat pick disappears at confirmation | Test planned | Same per-root extractor previews, captures, and revalidates | Visible |
| A button inside a paragraph is selected as content | Test planned | Reject control hit before searching for enclosing block | Visible |
| A pending touch pick survives a pane change | Test planned | Provider cancels previous or hidden-source pending pick | Visible |
| Selecting text outside mode still shows `+` | Test planned | Remove selection-driven branch | Visible |
| Touch tap follows a link or starts native text selection | Browser/synthetic touch check planned | Capture-phase click suppression and `userSelect: none` in mode | Visible |
| A pick with no active chat sink disappears | Test planned | Hide or disable global mode on standalone pages; existing sink warning remains | Silent if missed |

## Agent-flow / user-flow edge cases

- **ADDRESSED:** The agent receives the existing selection quote and source; no new serialization or migration is needed (`src/frontend/src/components/FileView/view.tsx:237-250`, `TranscriptSelection.tsx:16-27`).
- **PLANNED:** A touch confirmation rechecks through the same root-specific extractor that made its preview; the current check uses only the document extractor.
- **PLANNED:** Nested card embeds in chat supply their own file capture callback (`src/frontend/src/components/chat/markdown-rendering.tsx:143-163`), but the current point handler still intercepts them and recursive embeds need explicit sink forwarding.
- **DEFERRED:** Canonical anchors and moved sources remain in `issues/features/2026-07-08-selection-provenance-canonical-anchors.md`.
- **DEFERRED:** Native iOS WebView touch remains a physical-device check; synthetic browser events establish only the frontend branch.

## NOT in scope

- App toolbar, menus, controls, and composer internals: these are actions rather than card/chat content.
- Standalone pages without a mounted chat composer: no draft exists to receive a selection; the separate chat-input-everywhere issue owns that.
- Embedded PDFs and opaque frames: the DOM picker cannot inspect their content.
- New stored comments, all-comments list, image point pins, and screenshots: the request uses the existing chat attachment format.
- A target-enlargement UI or native long-press gesture: neither belongs to the requested button flow.

## Open design questions

Whether a future picker should cover arbitrary app UI remains open; lean toward card/chat content until actual feedback calls for controls. Whether the icon should later appear on standalone pages depends on a usable chat input there; lean toward hiding it when no draft exists.

## Knowledge audits

No agent-facing format or box guidance changes. The existing selection serialization stays unchanged, so no knowledge audit is needed.

## What will hold this after it ships

Focused DOM tests cover icon state, chat→card A→card B source ownership, card/chat extraction, chat touch confirmation, control-hit rejection, pending-pick cancellation on source change, and absence of text-selection `+` outside mode. `pnpm test:changed`, typecheck, lint, and layout checks cover the changed frontend. Browser checks at desktop and phone widths cover top-bar placement, hover preview, click attachment, chat-message targets, and the mobile confirmation step. A physical phone remains a separate manual check.

## Implementation order

1. Reopen the issue and write this plan. Obtain Codex plan review because the boxholder's Claude quota is exhausted.
2. Add global mode state and top-bar icon; remove card-local bar. Commit.
3. Wire card and chat capture with correct source positions; remove text-selection attachment. Add tests and commit.
4. Verify desktop and phone-width behavior with `bin/browse`, publish one exhibit, run changed tests/typecheck/lint/layout, obtain Codex diff review, and commit any fixes. Do not merge without a new finish request.

## Rollout shape

No data migration or endpoint change. Done when the sole Select icon is in the global top bar, both card and chat content attach to the existing draft, ordinary text selection no longer offers attachment, desktop and phone-width checks pass, and review findings are resolved or reported.
