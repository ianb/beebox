# Chat header re-IA: three stateful chips

**Status:** implemented 2026-08 — shipped as `ContextChip`, `VoiceChip`, and
`ChatMenu`, fixing the mobile-clipped "..." menu bug.

**Polish round (2026-08-01):** a boxholder-requested follow-up pass deviated
from this plan in two ways: Model selection now lives in `ChatMenu`, not
`VoiceChip` (this doc's Voice chip section above still describes the
original "Model: <current> ›" sub-panel location); and the `VoiceChip` face
became a split pill (mic half toggles narration, speaker half toggles mute)
rather than the single speaker-icon-plus-corner-dot face described above.
Also in this round: pill styling across all three chip triggers, a folder
icon on `ContextChip`, `Dropdown` panel-slide transitions (direction-aware,
width-transitioning with a `ResizeObserver`-driven viewport clamp), and
`MenuItem`/`MenuDivider` split out of `Dropdown.tsx` into
`src/frontend/src/components/ui/dropdown-menu-item.tsx`.

Replace the chat header's row of eight-plus icon buttons with three stateful
chips (context, voice, overflow menu). Each chip is both a status display and a
menu trigger. The row's controls are then a small fixed set whose only
flexible member truncates, giving it a known minimum width (supported minimum:
320px viewports), which fixes the bug where the "..." menu is clipped
off-screen on narrow phones.

## Problem

The chat header (`src/frontend/src/components/chat/InteractiveChat-layout.tsx:43`)
is a non-wrapping flex row with no responsive classes. An ancestor
(`InteractiveChat-layout.tsx:271`) has `overflow-hidden`. When the row's
intrinsic width exceeds the viewport, the rightmost items are clipped: still in
the DOM and a11y tree, but invisible and unreachable. The "..." menu is the last
item, so it is the first casualty. Browser-verified: at 320px the "..." button
sits at `left: 322.8px` — fully off-screen. The break point depends on which
conditional items render (context link, landmark button, narration badge), so
"fits on my phone" is never a stable property of the current row.

Beyond the bug, the row mixes four jobs at one visual rank: status display
(narration badge, context path), persistent preferences (mute, narration),
occasional navigation (landmarks, recent files, session history), and session
plumbing (new session, the debug menu). Boxholder-reported frequency: mute is
frequent; model/landmarks/recent-files are occasional; new session and session
history are rare; seeing mute/narration/context state matters more than most of
the buttons.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — principle 2 (exhaustiveness; frontend
  `.tsx` bans `default:` cases), principle 4 (resilient AND never silent),
  principle 7 (hierarchy is a discoverability contract), principle 8 (one way
  to do each thing — reuse the existing submenu-panel idiom), principle 9
  (formal structure: closed unions for panel state).
- `frontend.md:28` — "Components in components/ own their appearance"; all
  touched files live under `components/`, so no `restrict-component-classes`
  constraint applies. `frontend.md:78` — the `<Dropdown>` + `<MenuItem>` +
  `<MenuDivider>` primitives this plan composes.
- `code-style.md:69` — "User-initiated actions never silently no-op"; governs
  empty-menu states. `code-style.md:110-111` — PascalCase single-component
  files, 300-line file cap (forces the new chips into their own files).
- `docs/testing.md:13-17` — "Doctests are the default"; frontend doctests cover
  logic modules, not JSX (`test/frontend/session-list-grouping.doctest.md` is
  the precedent shape).
- Shipped precedent: the 2026-07-19 mobile-overflow fix wave
  (`issues/closed/bugs/2026-07-19-landmark-menu-overflows-mobile.md`,
  `issues/closed/code-quality/2026-07-19-sessionlist-menu-latent-overflow.md`)
  — those fixes moved menus onto the shared `Dropdown`; this plan extends the
  same consolidation to the trigger row itself.

## What already exists

- **`Dropdown` / `MenuItem` / `MenuDivider`** (`src/frontend/src/components/ui/Dropdown.tsx:52,224,277`)
  — portaled, viewport-clamped menu primitive. Reused for all three chips,
  with one small addition (open/close focus management — see Direction); it
  has no keyboard focus handling today.
- **Submenu-panel idiom** (`InteractiveChat-debug-menu.tsx:96-99`): *"Single-panel
  submenu pattern: the dropdown swaps which set of rows it renders rather than
  spawning a flyout."* — `useState<"root" | "model" | "voice">` plus
  `MenuItem keepOpen` back-rows, reset via `onClose`. Reused for every chip
  sub-panel (principle 8); no new panel mechanism.
- **`ChatDebugMenu`** (`InteractiveChat-debug-menu.tsx:38-184`) — the current
  "..." menu. Restructured and renamed, not rebuilt: its Model and Voice panels
  move to the voice chip; its debug items stay.
- **`useChatMute`** (`InteractiveChat-hooks.ts:201-224`) — mute state persisted
  to `localStorage["chat-muted"]`. Reused unchanged; only the toggle's UI home
  moves.
- **Narration state** (`InteractiveChat-hooks.ts:136-166`) — server-side
  per-session `chatFeatures` synced over SSE, optimistic toggle. The success
  path reconciles from the server response (`InteractiveChat-hooks.ts:162`);
  the rejection path only logs (`InteractiveChat-hooks.ts:163-165`) — no
  rollback, no refetch, and a rejected write produces no SSE correction, so
  the UI can show wrong state indefinitely. This plan fixes that (see
  Direction: settings-mutation error ownership); the state plumbing itself is
  reused.
- **`trpc.landmarks.forDir`** (`LandmarkLinksButton.tsx:44-47`) — supplies
  landmark links, groups, and `landmark.label`. Reused; the context chip's face
  label comes from this same query instead of widening `ChatContextLink`'s
  props.
- **`RecentFilesButton`** (`RecentFilesButton.tsx:29-52`) and
  **`SessionListButton`** (`SessionListButton.tsx:35-65`) — their menu content
  and data wiring are lifted into chip sub-panels; the standalone trigger
  buttons are deleted.
- **`TargetStrip`** (`TargetStrip.tsx:20-66`) — one-tap "Stop speaking" /
  "Stop agent". Untouched. Scope stated precisely: the strip exists only
  during activity and its stop-speech button only while audio is playing
  (`TargetStrip.tsx:29,40`) — it covers the *urgent* mute case, not
  pre-emptive mute. Pre-emptive mute (no speech playing) is the non-urgent
  case where the boxholder accepted two taps.

## Prior art (external)

- Priority+ (measure-and-collapse) overflow pattern: canonical write-ups at
  https://bradfrost.com/blog/post/revisiting-the-priority-pattern/ and
  https://css-tricks.com/the-priority-navigation-pattern/. Rejected here:
  ResizeObserver-driven collapse mutates layout after layout, inviting a second
  layout pass and visible reflow (https://web.dev/articles/resize-observer),
  and a fixed three-chip set makes the measurement machinery unnecessary.
- Split button (tap-toggles + chevron): NN/g found ~80% of test participants
  never discovered the menu half, and touch targets must be large for both
  halves (https://www.nngroup.com/articles/split-buttons/,
  https://www.nngroup.com/articles/split-buttons-navigation/). Rejected — this
  motivated the single-target chip whose whole face opens the menu.
- Counter-precedent, recorded honestly: Google Meet and Slack huddles keep mute
  as its own one-tap target with settings behind a separate three-dot menu
  (https://support.google.com/meet/answer/12562325,
  https://slack.com/help/articles/1500002037922). This plan accepts two-tap
  mute anyway because `TargetStrip` already provides the one-tap urgent case
  ("stop speaking now") and the boxholder confirmed two taps is acceptable
  when state stays visible.
- Menu-button a11y: WAI-ARIA APG menu-button pattern
  (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) — `aria-haspopup` +
  `aria-expanded` on the trigger; state belongs in the accessible *name*
  ("Voice — muted, narration on"), not `aria-pressed` (Deque:
  https://www.deque.com/blog/accessible-aria-buttons/ — toggle semantics and
  popup semantics are different controls). The shared `Dropdown` does NOT
  currently implement the pattern's keyboard behavior (no focus-first-item on
  open, no arrow-key navigation, no focus restore on close) — this plan does
  not claim APG conformance; it adds minimal focus management (see Direction)
  and defers arrow-key roving (see NOT in scope).
- Touch targets: Apple HIG 44×44pt, Material 48×48dp, WCAG 2.2 SC 2.5.8
  24×24px minimum (https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/).
  Chips get ≥40px hit height (visual face may be smaller); the current 28px
  icon buttons were below every guideline, so the chips are also an a11y
  improvement.
- Menu depth vs toolbar clutter: Smashing Magazine's mobile-navigation survey
  states the trade directly — hidden navigation costs two taps; pull frequent
  actions onto the bar (https://www.smashingmagazine.com/2017/05/basic-patterns-mobile-navigation/).
  Applied via the frequency sort above: only state display stays on the bar.

## Direction

One header, identical at every width (no desktop/mobile fork — muscle memory
transfers between phone and laptop):

```
[Chat] [context chip………(truncates)]  ·spacer·  [voice chip] [⋯]
```

**Context chip** — face label chooser over `dir: string | null` plus the
landmark query: landmark `label`, else `dir` basename, else "Box root" when
`dir === ""` (the empty string is a real value meaning box root — see
`SessionListButton.tsx:99` — and must not fall through to the no-context
label), else "Files" when `dir === null` (no context; the chip still exists
because it carries recent files). Truncating flex item (`min-w-0` +
`truncate`); `title` shows the full path. Menu root: an "Open <dir>/" browse
link (replaces `ChatContextLink`), landmark links and groups (rendered by a
`LandmarkLinksPanel` extracted from `LandmarkLinksButton`), divider,
"Recent files ›" sub-panel (a `RecentFilesPanel` extracted from
`RecentFilesButton`). When the landmark has no links, the links section is
absent but the chip and menu remain — unlike today's
`LandmarkLinksButton.tsx:52` `return null`. The `landmarks.forDir` query's
error state is rendered as an explicit "Couldn't load landmark links" row —
today the error is discarded and indistinguishable from "no links"
(`LandmarkLinksButton.tsx:44-52`), which violates resilient-and-never-silent
(principle 4).

**Voice chip** — face: speaker icon reflecting mute state (slashed when muted),
plus a small corner indicator dot when narration mode is on. The existing
`hqInFlight` signal is today the literal text `· transcribing…` on the
narration badge (`InteractiveChat-controls.tsx:143`); that readable text is
preserved — while HQ transcription is in flight the chip face shows a
transient "transcribing…" label next to the icon, not just a dot state.
Accessible name carries the state ("Voice — muted, narration on"). Menu root:
Mute (✓ when on), Narration mode (✓ when on), divider, "Model: <current> ›"
sub-panel (moved from the debug menu, current selection named on the row),
"Voice settings ›" sub-panel (moved likewise, including HQ transcription).

**Settings-mutation error ownership** — the mutations behind these rows
currently fail silently-wrong: narration rejection only logs and strands the
optimistic state (`InteractiveChat-hooks.ts:163-165`); model selection posts a
"Switched to" marker and sets the model before the request, and rejection only
logs, leaving both false signals (`InteractiveChat-hooks.ts:171-192`);
transcription-service mutations likewise only log
(`InteractiveChat-debug-menu.tsx:76`). As part of moving these controls into
the voice chip, each rejection path rolls back its optimistic state and
surfaces the failure (toast or inline row state) — per code-style.md:69,
"User-initiated actions never silently no-op."

**Dropdown focus management** — minimal addition to the shared primitive:
focus the first menu item when a dropdown opens via keyboard, and restore
focus to the trigger on close. Full arrow-key roving focus is deferred (NOT in
scope).

**"..." chip** — `ChatDebugMenu` renamed to `ChatMenu` (`ChatMenu.tsx`),
aria-label "Chat menu" (was "Debug controls"). Root: New session, "Recent
chats ›" sub-panel (a `SessionListPanel` extracted from `SessionListButton`),
divider, "Advanced ›" sub-panel: Debug View, Debug Log (mobile-only,
unchanged), Run /compact, Restart Subprocess, Stop Process, session/process
status footer. The session list's load failure currently renders as
"No sessions yet" (`SessionListButton.tsx:84-95` catches, clears loading, and
falls through to the empty state); the lifted panel gets an explicit error row
with retry instead.

The lifted menu bodies (`LandmarkLinksPanel`, `RecentFilesPanel`,
`SessionListPanel`) are separate files, each owning its own fetch/error
state — the bodies are substantially larger than their trigger wrappers, and
folding them into the chip files would blow the 300-line cap
(code-style.md:111).

Deleted from the header: `MuteButton`, `NarrationStatusBadge`,
`LandmarkLinksButton` (trigger), `RecentFilesButton` (trigger),
`SessionListButton` (trigger), `NewSessionButton`, `ChatContextLink`. Every
action survives, relocated. `data-cb-source` tagging on lifted menu content is
preserved (`frontend.md:7`).

**Vocabulary lock-ins:** component names `ContextChip`, `VoiceChip`,
`ChatMenu`; aria-label "Chat menu"; panel unions are closed string-literal
types dispatched without `default:` (principles 2, 9).

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| `landmarks.forDir` query slow → chip face has no label yet | no | plan: fall back to dir basename immediately (label is an upgrade, not a dependency) | clear — face always renders something |
| `landmarks.forDir` query FAILS → today indistinguishable from "no links" (`LandmarkLinksButton.tsx:44-52`) | no | plan: explicit "Couldn't load landmark links" row in the menu | clear once built; today silent |
| Session list load fails → today renders "No sessions yet" (`SessionListButton.tsx:84-95`) | no | plan: explicit error row with retry in the Recent-chats panel | clear once built; today silently wrong |
| No context dir AND no recent files → context chip menu is empty | no | plan: "No recent files yet" placeholder row | clear (code-style.md:69 — no silent no-op) |
| Narration toggle rejected by server → today optimistic state strands, rejection only logs (`InteractiveChat-hooks.ts:163-165`); no SSE correction follows a rejected write | no | plan: roll back optimistic state + surface failure | clear once built; today silently wrong |
| Model switch rejected → today "Switched to" marker and selection persist as false signals (`InteractiveChat-hooks.ts:171-192`) | no | plan: roll back marker/selection + surface failure | clear once built; today silently wrong |
| Root-context chat (`dir === ""`) mislabeled as no-context "Files" | doctest (label chooser covers `"" vs null`) | plan: `""` maps to "Box root", distinct from `null` | clear |
| `localStorage` unavailable → mute not persisted | no | yes, existing try/catch in `useChatMute` (`InteractiveChat-hooks.ts:205-209`) | silent-but-safe (session-local mute still works); pre-existing, unchanged |
| Landmark label extremely long → chip could re-inflate the row | no | plan: `min-w-0` + `truncate` on the chip, the row's only flexible item | clear — acceptance criterion: verified at 320px in chunk 5 |
| Panel state stale across opens (menu reopens on "voice" panel) | no | existing idiom: `onClose` resets to `"root"` (`InteractiveChat-debug-menu.tsx:107`) | clear |
| Chips + title still overflow below the supported minimum | no | the chip set is fixed and the only flexible item truncates, so the row has a small, known minimum width; acceptance criterion: all controls visible and operable at 320px, verified in chunk 5 | clear |

Four rows above are pre-existing silent failures this plan converts to visible
handling (the two data panels, narration, model). They are in-scope fixes, not
accepted risks. No unresolved critical gaps remain *in the plan*; the "once
built" cells are acceptance criteria for the chunks that build them.

## Agent-flow / user-flow edge cases

This is user-facing chrome; box agents never operate the chat header. Most of
the standard seven do not apply, stated explicitly:

- **Wrong tag / wrong field** — N/A; no agent-written vocabulary.
- **Stale ref** — ADDRESSED: the context chip's browse link can point at a
  dir that was moved/archived; that link exists today
  (`InteractiveChat-controls.tsx:357`) and browse's own missing-path handling
  is unchanged by this plan.
- **Two agents touching the same card** — N/A; no card writes.
- **Hand-edit drift** — N/A; no on-disk format.
- **Fabricated free-form value** — N/A.
- **Validation error UX** — N/A; no new validation boundary.
- **Partial migration / transition state** — ADDRESSED: no data-shape change;
  `localStorage["chat-muted"]` key and the `chatFeatures` wire contract are
  untouched. The only transition is within this branch, which ships whole.

One edge case specific to this plan: **iOS native composer parity**
(`issues/features/2026-07-19-ios-input-plane-parity.md`) — the native input
plane mirrors composer affordances, not the header, so this plan does not
change the native contract; noted in NOT in scope.

## NOT in scope

- **`TargetStrip` / blue activity bar** — boxholder likes it as-is; it is a
  load-bearing assumption (one-tap stop-speech) but not a change target.
- **Composer and its "+" menu** — separate surface, already mobile-adapted.
- **Priority+ measured auto-collapse** — rejected with rationale in Prior art.
- **Full APG menu-button keyboard model** (arrow-key roving focus, typeahead)
  for `Dropdown` — this plan adds only focus-on-open and focus-restore; the
  full keyboard model is a shared-primitive upgrade affecting every existing
  menu, worth its own pass.
- **Model indicator on the closed chip face** — boxholder accepted menu-deep
  model status; revisit only if "what model am I on" turns out to need
  glanceability.
- **One-tap mute on the bar** — consciously traded away (see Prior art
  counter-precedent); `TargetStrip` covers urgency.
- **iOS native input plane** — tracked separately
  (`docs/plans/ios-input-plane-parity.md`); no native contract changes here.
- **Persisting narration client-side** — narration stays server-side
  per-session state; no new localStorage keys.
- **i18n** — labels remain inline English literals, matching every existing
  component; no copy framework exists to hook into.

## Open design questions

- Exact visual treatment of the narration indicator (dot size/color, pulse for
  `hqInFlight`) — settled during implementation via screenshot review with the
  boxholder; the structural decision (corner indicator on the voice chip face)
  is locked.

## Knowledge audits

Skipped with rationale: this plan introduces no agent-facing concept — no tag,
card shape, or convention a box agent must recall. It is human-facing UI
chrome; the agent guide and schema instructions are untouched.

## Implementation order

Chunks are commit boundaries, not ship boundaries; the branch merges whole.

1. **`Dropdown` focus management** — focus first item on keyboard open,
   restore focus to trigger on close. First because every later chunk builds
   menus on it, and it's a self-contained shared-primitive change verifiable
   against the existing menus.
2. **`ChatMenu`** — rename `InteractiveChat-debug-menu.tsx` → `ChatMenu.tsx`;
   restructure to New session / Recent chats › / Advanced ›; extract
   `SessionListPanel` (own fetch/error/retry state) from `SessionListButton`
   for the Recent-chats panel; delete `NewSessionButton` and the
   `SessionListButton` trigger from the header.
3. **`VoiceChip`** (`VoiceChip.tsx`) — new chip; move Mute, Narration, Model,
   Voice settings into it (Model/Voice panels move out of `ChatMenu`); add
   rollback + user-visible failure to the narration/model/transcription
   mutation rejection paths; delete `MuteButton` and `NarrationStatusBadge`
   from the header; extract the accessible-name builder as a pure function.
4. **`ContextChip`** (`ContextChip.tsx`) — new chip; extract
   `LandmarkLinksPanel` and `RecentFilesPanel` (each with explicit error
   states); merge `ChatContextLink`'s browse link; extract the face-label
   chooser (`null` vs `""` vs path) as a pure function.
5. **Header cleanup + verification** — simplify `ChatHeader` JSX to the
   three-chip shape with `min-w-0` discipline; browser pass at 320/375/390/1280
   via `bin/browse` with screenshots; close/file the originating issue.

## Rollout shape

- **Tests first, as design tools** (`docs/testing.md`): three new doctests —
  `test/frontend/context-chip-label.doctest.md` (label chooser: landmark
  label → dir basename → "Box root" for `""` → "Files" for `null`),
  `test/frontend/voice-chip-face.doctest.md` (render doctest via
  `renderToStaticMarkup` over the mute × narration × hqInFlight state space —
  face icon state, indicator presence, "transcribing…" text, accessible name;
  precedent: `test/frontend/speech-progress-indicators.doctest.md` renders
  `SpeechChunk` the same way), and error-state assertions for the lifted
  panels (error row renders when the query/load fails) where the panel's
  fetch state can be driven without a browser.
- **Done-when:** doctests pass; `pnpm typecheck` + `pnpm lint` clean; at
  320px every header control is visible and operable (the original bug's
  repro), verified with `bin/browse` screenshots at 320/375/390/1280, menus
  open un-clipped at each width; settings mutations show visible failure when
  rejected (verified by driving a rejection); boxholder has eyeballed the chip
  faces (narration indicator styling).
- **No migration**: no persisted data shape changes.
- Ships as one unit by merging the worktree branch to main on the boxholder's
  explicit signal.
