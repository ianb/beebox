# Plan Engineering Review — workspace pane controls

Independent review: Claude Opus, 2026-09-08. The primary agent verified findings
against source and revised [the plan](workspace-pane-controls.md). The reviewer
read an earlier draft while mobile-state and deferred directory/Dashboard edits
were being made. Dispositions below describe the revised plan, not shipped code.

## What already exists

The reviewer verified all original source-table quotations, the single tab strip,
cap, close-all action, singleton transcript, and shared callout renderer. Additional
owners matter: useViewNavigate opens ViewOverlay; mobile opens route away; card
context retains mounted focus claims. These now appear in the boundary table.

## Prior art (external) — verified

The [VS Code layout documentation](https://code.visualstudio.com/docs/configure/custom-layout)
describes editor groups and focused layouts. The [ARIA tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
and its [automatic activation example](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-automatic/)
support the tablist and activation guidance. The primary agent checked these
sources; the independent reviewer confirmed their limited relevance. None
supplies the requested conversation-background semantics.

## Stated preferences this plan trades against

Direct user choices govern per-pane chat, opposite-pane opens (including hidden
existing tabs), tiered desktop focus, single-pane mobile, no drag/picker, and
floating restoration. Engineering principles §8–10 support a pure decision core;
§13 supports controls that expose retained state. Later directory/Dashboard tab
support is explicitly deferred rather than excluded as a product direction.

## Could this be simpler? (verified)

Renaming close/pop-out cannot represent two card selections or atomic hidden-tab
moves. Two unrelated tab reducers cannot enforce uniqueness without another
coordinator. One shared reducer plus existing tab/view data is justified. A
universal docking system, generic target registry, and landmark persistence are
not required. Existing stable conversation-start identity should be reused.

## Failure modes

The material gaps were mobile foreground state, unreachable retained cards,
mount-based focus claims, browser Back after showing chat, and competing route
owners. Each now has a handling rule and an acceptance case. Real mounted-state
checks use browser probes rather than claiming the Node doctest tier has a DOM.

## Agent-flow / user-flow edge cases

The review traced two-card split → one chat pane → restore, opening a hidden
pinned card opposite chat, phone transcript toggling and Back, and full transcript
with hidden mounted cards. Recipient selection remains separate from attention.
Future agent show-card commands and review completion remain filed follow-ups.

## Findings

### Mobile foreground must be independent of desktop layout

**Location in plan:** Track A state and Track C mobile projection.

**Citation:** Earlier draft: “Returning to desktop restores the saved split or
focus arrangement.”

**Issue:** Two active pane selections cannot express which card is foreground on
mobile. Writing desktop pane display flags for phone toggles loses the arrangement.

**Why it matters:** A phone interaction changes the recovered desktop layout.

**Suggested action:** Add mobile foreground state and explicit viewport inputs.

**Traces to preference:** Single-pane mobile must retain desktop arrangement.

**Disposition:** Addressed. MobileView, lastInteraction, viewport-bearing actions,
return-path repair, and resize behavior are explicit. Intentional opens may change
tab ownership/reveal their destination; viewport changes alone do not move cards.

### Every chat pane needs restoration; move must reveal its target

**Location in plan:** Tracks A and C controls.

**Citation:** Earlier draft: “the other chat pane may offer its own Show cards.”

**Issue:** This did not guarantee restoration in an ordinary half-split or define
whether moving a card into a chat-displaying pane revealed it.

**Why it matters:** Retained cards become hard to reach; Move could hide its result.

**Suggested action:** Always offer restoration when that pane retains cards;
move reveals and selects its destination.

**Traces to preference:** Per-pane toggles and state-revealing controls (§13).

**Disposition:** Addressed. Empty-source normalization and ordering are also stated.
The review's claim that hidden selections lose cap protection was rejected: the
plan already protects both retained pane selections, whether visible or not.

### Hidden mounts must not own published card focus

**Location in plan:** Track D attention.

**Citation:** `src/frontend/src/components/chat/everywhere/card-context-store.ts:10`:
`const next = [...cards.values()].at(-1) ?? null;`

**Issue:** Retained mounted cards keep claims even when the transcript fills the
workspace. Mount order is not visible tab activation order.

**Why it matters:** Native attention can identify a hidden card as the open card.

**Suggested action:** Workspace visibility and activation own focus claims;
hidden roots release them without unmounting.

**Traces to preference:** Inspecting or hiding content must not silently change
conversation destination or publish false attention.

**Disposition:** Addressed. No visible cards means focusedRef is null; two-card
activation and fallback are explicit. Verify in the real-component harness.

### Mobile transcript toggles must preserve browser Back

**Location in plan:** Track B history.

**Citation:** `src/frontend/src/components/chat/everywhere/use-conversation-route.ts:75`:
`if (overlay) window.history.back();`

**Issue:** Replacing every toggle's history entry removes the card's return entry.

**Why it matters:** Device Back skips the card after showing the transcript.

**Suggested action:** Push mobile showChat; restore via the matching return entry,
with a deterministic fallback. Keep focus/move as replacement actions.

**Traces to preference:** Mobile needs a quick, reversible card/transcript switch.

**Disposition:** Addressed in the history contract, failure table, and phone
walkthrough. Excluded route overlays keep their existing history contract.

### Account for the actual mobile and overlay presentation owners

**Location in plan:** Source table and Tracks B/C.

**Citation:** `src/frontend/src/components/chat/InteractiveChat-view.tsx:291`:
`hasCompanion={!mobile`; `src/frontend/src/hooks/useViewNavigate.ts:30`:
`overlay.open(target, hint)`.

**Issue:** The old 40vh mobile CSS is currently gated off. Deleting it alone does
not replace mobile route-away or ambient/in-card overlay opens.

**Why it matters:** Links could bypass tabs and the new control state entirely.

**Suggested action:** Replace the mobile opener/gate and chat-only URL owner;
route participating ViewOverlay opens through the workspace adapter.

**Traces to preference:** One mobile pane and consistent opposite-chat tab opens.

**Disposition:** Addressed. Obsolete vertical split removal remains explicit;
it is not presented as the only behavior change.

## NOT in scope (verified)

The plan files or links deferred landmark baselines, review queues, saved sets,
agent presentation, open-link styling, and preview policy. Directory and Dashboard
tabs were added after review began; the primary agent checked their extension
boundary and issue links. No implementation is authorized by filing these issues.

## Things I checked and found clean

The template headings, original citations, singleton ownership, no-remount
requirement, focus ladder, uniqueness, cap, and pin preservation were checked.
The primary agent corrected a storage-helper claim: it exists in the sibling
chat-everywhere checkout, but was not found in main during final verification.
Preflight must integrate it deliberately. Legacy import now checks actual router
slug provenance rather than assuming every old development key is ambiguous.
Floating-slot ownership is specified; only visual spacing remains for iteration.
Documentation and whitespace checks are the validation for this planning pass;
implementation tests have not been run because this pass changes no engine code.


## Implementation review and verification

Claude reviewed the workspace model, browser storage, route/history adapter,
card mounting, conversation ownership, and native attention consumers. Five
material findings were accepted and corrected:

- Two visible cards must publish the last activated card, including a neighbour
  selected after closing the active tab, rather than always the right pane.
- A failed storage read must install that conversation's cached or empty state,
  never retain the previous conversation's cards under the new identity.
- Workspace URL projection must wait for confirmed conversation route binding
  and must never write the selected session itself.
- Mobile restoration must honour the recorded return card's pane.
- Reopening an unchanged foreground card must replace the current history entry;
  changes to the actual target still push.

Browser verification additionally exposed a React Compiler boundary: mutable
store identity needs its own external-store subscription for the ready gate.
The reload walkthrough now covers this. A pending Codex start also required the
route owner to recognise retained startup history after card navigation; the
regression checks that explicit New still works and changed startup parameters
still create a new request.

Desktop and phone browser checks verified retained DOM/scroll-container identity,
Properties state through focus/hide/move, opposite-chat routing with no duplicate,
and mobile card/transcript restoration. The persistent tour has three paired
checkpoints with no axe violations and includes a reload assertion. Physical
iOS keyboard, voice, and in-flight-send acceptance remains outstanding.

Full typechecks, changed-file lint, documentation checks, and whitespace checks
passed. The final broad selected suite ran 1,768 assertions: 1,766 passed; two
assertions failed in the CLI invalid-card diagnostic case. Its isolated rerun
passed all 20 assertions. That intermittent failure is tracked in
[the CLI issue](../../../issues/bugs/2026-09-08-view-test-invalid-card-diagnostic-missing-under-load.md).


The second, bounded review confirmed all five earlier fixes and identified
three additional integration defects. Storage notices now have an explicit
external-store subscription; close actions carry the actual viewport rather
than inferring it from retained mobile state. Assignment keeps a transient
from/to ownership handoff for visibility and waits for the conversation route
to confirm the assigned session before restamping workspace history. It does
not write the selected session itself or replay the card URL during adoption.
A simulated assignment through the real UI callback is checked separately from
physical-device acceptance.


Final assignment probe: invoking the real UI assignment callback produced no
hidden-attribute transition; the same card DOM node remained visible and the
workspace owner matched the assigned conversation. The adoption marker and
identity are published atomically by the browser store, avoiding a React
priority gap between component state and external-store notifications. A
blocked-storage browser probe displayed the persistence notice while keeping
the card usable. A long card retained its 240-pixel scroll position across
conversation/restore. The expanded desktop/mobile tour also passed pending-start
card navigation, retaining both cards without sending a message.
