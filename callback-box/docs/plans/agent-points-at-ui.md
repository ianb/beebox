---
title: "The agent sees the interface and points at controls in it"
status: partial
workstream: points-at-ui
issues:
  - ../../../issues/closed/features/2026-08-14-agent-can-see-and-point-at-the-interface.md
---

# The agent sees the interface and points at controls in it

The box agent cannot see the running interface. This plan gives it two things:
a way to ask what controls are on the user's screen right now, and a way to
write a tappable reference to one of them inside its answer. It covers web and
the iOS native shell, because on iOS the entire input plane is native and a
DOM-only design would answer the phone case with nothing.

## Job to be done

Three situations, all real, all voice-first or close to it.

**"Where is that?"** When the boxholder is holding the phone, half-listening,
and asks *"where do I turn narration off?"*, I want the answer to be a thing I
can tap, so I do not have to hold a spatial description in my head and then
hunt for it. Prose about UI location is the worst possible answer to receive by
ear.

**"How do I do X?"** When I ask *"how do I attach a photo to this?"* while
walking, I want the agent to put the first step in front of me — open the right
menu — so I can carry on from there without it doing the thing for me. I am
asking to be shown, not to be driven.

**"Is that even there?"** When the agent tells me a feature exists and I cannot
find it, I want the agent to be describing something it can actually see on my
screen, so that "it's in the menu next to the send button" is a checkable claim
rather than a plausible guess from its prompt. Today it cannot check.

The pointer is a link in the sentence that motivates it. That placement is the
point: a reference is useful contextualised, and the surrounding prose is what
the ear gets when the eye is elsewhere.

## Stated preferences this plan trades against

- `docs/engineering-principles.md`
  - **1 (types are structure)** — the control-entry shape and the action
    vocabulary are closed unions, not string bags.
  - **2 (exhaustiveness)** — the `point` / `focus` / `reveal` dispatch and the
    `classifyMarkdownHref` kind switch must fail to compile on a new member.
  - **3 (validate at boundaries)** — the scan payload crosses browser → HTTP →
    CLI, and the native inventory crosses a `WKWebView` bridge. Both are Zod
    boundaries.
  - **4 (resilient AND never silent)** — the central discipline here. A pointer
    that cannot resolve must read as broken, and a scan that cannot see the
    native half must say so instead of returning a short list.
  - **6 (right-sized defensiveness)** — the browser scan is untrusted-boundary
    data; the interior resolver is not.
  - **8 (one way to do each thing)** — one pointer vocabulary shared with the
    existing card-path link convention, one dump format shared with the tours'
    a11y snapshot idiom.
  - **11 (enforcement beats convention)** — the reveal/do boundary is an
    explicit author opt-in checked by a doctest, not an inference from markup
    and not a request that the agent be careful.
- `callback-box/CLAUDE.md` — "don't add features beyond what the task
  requires"; the `src/shared/ref-path.ts` fails-closed precedent.
- `callback-box/code-style.md` — no default parameters, max two positional
  params, `as` ban, the `Result`-vs-throw split, logging levels.
- `callback-box/frontend.md` — primitives own appearance, `className` is
  outer-layout only, `restrict-component-classes`.
- **Precedents, denser than the docs:**
  - `src/webapp/routes/chat-screenshot-routes.ts` — the agent→browser
    round-trip, with its outcome vocabulary and its loopback auth split.
  - `src/frontend/src/components/Markdown.tsx:150-156` `BrokenLink` — the
    established treatment for a link that leads nowhere.
  - `src/frontend/src/lib/selection/` — the mirror-image token scheme
    (client→agent), including its deliberately freeform position string.
  - `docs/mobile-contract.md` — the anchor-manifest discipline any bridge
    change must satisfy.

## What already exists

**The agent→browser round trip is built.**
`src/core/pending-browser-request.ts:1-24` is the generic rendezvous: *"a route
broadcasts that id to connected browser tabs; a tab answers by delivering a
payload (`fulfill`, first-wins) or by reporting 'I have nothing'
(`reportNone`…). Silence times out."* It already carries the two-phase ack that
distinguishes `no-client` from `timeout`
(`pending-browser-request.ts:11-18`). `chat-screenshot-routes.ts:1-31` is a
complete worked consumer, and `src/cli/commands/chat.ts:186-275` is its CLI
half, including the outcome switch (`declined` / `no-client` / `timeout` /
`failed`). **Reused wholesale.** `cb chat ui` is a sibling of `cb chat
screenshot` with a JSON fulfillment instead of a PNG.

**The link seam is exactly where the issue says it is.** There is no chat
`Link` override — `src/frontend/src/components/chat/markdown-rendering.tsx`
returns only `Para` and `Img`, with the comment *"No `Link` override: the
shared `makeLink` … already renders a plain-path link that opens in the
sidebar."* So chat links go through `makeLink`
(`src/frontend/src/components/Markdown.tsx:92-141`) switching on
`classifyMarkdownHref` (`src/frontend/src/lib/view-url.ts:151-165`), which
returns `legacy-view | relative | external`. **Reused**: a `control` kind is a
new member of that union, and `BrokenLink` (`Markdown.tsx:150-156`) is already
the rendering for an unresolvable target.

**Accessibility coverage is good enough to carry the dump.** 101 `aria-label`,
138 `title`, 53 `role`, and menus carry `role="menu"` / `role="menuitem"`
(`src/frontend/src/components/ui/Dropdown.tsx:311`,
`dropdown-menu-item.tsx:65-99`). The composer is a named region —
`InteractiveChat-composer.tsx:188` `<section aria-label="Compose message">` —
and every control in it has an accessible name. **Reused as the base of the
dump**, per the issue's decided direction.

**But there is no chokepoint component.** `Button` is imported by 28 files
against **139 raw `<button>` elements**, and the chat composer is 100% raw
`<button>` (seven in `InteractiveChat-composer.tsx` alone). Any design that
threads a prop through a shared primitive is dead on arrival. **This is why the
scan reads the DOM, and why the address is a plain `id` and the enrichment a
`data-` attribute** — all three work on a raw `<button>` with no component
migration.

**Tours already run axe on every page, which is this plan's uniqueness check.**
`bin/tour --all` walks all ten routed pages at two viewports and writes
axe violations per checkpoint, suppressing only `color-contrast`
(`test/tours/tour-lib/axe.ts:29-33`). axe-core 4.11.4 — already a dependency —
still ships `duplicate-id`, `duplicate-id-active` and `duplicate-id-aria`.
**Reused as the enforcement for control addresses**: because an address *is* a
DOM id, a duplicated one fails an instrument the project already runs, with no
new checker to build. The frontend's existing authored-id surface is small and
tidy (21 ids, all kebab-case and semantic; generated label/control pairs go
through React `useId()` in `ui/fields.tsx` and `ui/Accordion.tsx`), so a `cb-`
prefixed namespace lands with nothing to collide with.

**Tours already print an a11y tree, and agents here already read it.**
`test/tours/tour-lib/browse.ts:122-135` parses `` `<role> "<name>" [ref=eN]` ``
out of `bin/browse snapshot`, and `docs/tours.md:39-50` archives
`<checkpoint>.<viewport>.ax.txt` per run. **Reused as a format precedent** —
the dump uses the same `role "name"` idiom so an agent reading one can read the
other. Not reused as a mechanism: Playwright's snapshot runs over CDP, which
the page's own JavaScript cannot do.

**The per-turn context channel exists but is the wrong carrier here** — see
"Snapshot per turn, or on demand" below. `composeSendSnapshot`
(`src/core/session-context.ts`) → `composeChatAppSnapshot`
(`src/core/chat/features.ts`) emits `<chat-app narration prose local-time
channel last-activity health todos open-card/>`. **Reused for one attribute
only** (`channel`, Track 5), not for the dump.

**The iOS bridge has a transport to reuse and a command shape that must
change.** `NativeComposerContract.swift:65-74` defines
`NativeComposerCommand.Kind` with a single member, `addSelection` — but the
struct also declares a non-optional `selection` decoded unconditionally
(`:88`), and its acknowledgement is `{accepted, reason?}` with no room for a
payload (`:108-150`). So the command itself is **rebuilt** (Track 5), not
reused. The neutral transport is
`window.callbackboxNativePost(channel, payload)`
(`ChatWebView.swift:765-832`), which the Android plan fixed as the
cross-platform shape (`docs/plans/android-companion-app.md`, Track 0).
**Reused**: pointing at a native control is a new `Kind`, not a new channel.

**Prompt conventions have one home.**
`src/core/chat/session/prompts.ts`, section "Showing things in chat": *"When
you point the user at a file or card, link its plain box path… Always write the
box path with a leading `/`."* **Extended, not duplicated** — the `control:`
convention lands in that same section, immediately after, so the two kinds of
pointing are read together.

**Nothing collapses old context.** Searched for it; there is no mechanism. The
`<chat-app>` snapshot is prepended to the user message *text*
(`src/core/chat/session/start.ts:178`: ``text: `${snapshot}\n${rawInput.text}` ``)
and therefore stays verbatim in the SDK transcript for the session's life.
`stripChatAppTags` (`src/shared/chat-tags.ts`) is display-side only. This is a
load-bearing fact for the on-demand decision below.

## Prior art (external)

**memory-atlas** (`~/src/memory-atlas`) — read in full. The shape is right and
the numbers are the argument against its central choice.

- `lib/help/getdomllmhelp.ts` queries `[data-llm-action]`, and drops any
  element that lacks a DOM `id`, is invisible, or has an empty action string.
- The result is presented as writable links:
  `` `Button [${h.visibleAs}](#help=${h.elementId}) performs the action: ${h.actionDescription}` ``
  followed by the output convention
  (`lib/help/domhelprepresentation.ts:1-19`). **Copied**: presenting each
  control in exactly the syntax the model should write back is the single best
  idea in it.
- `lib/chat/tools.ts:181-201` returns the blob with
  `trimmedRepresentation: { userMessageLimit: 1, trimmedContent: "[help omitted]" }`,
  and `lib/chat/gptserialize.ts:337-352` replaces the content once **one** user
  message has followed. So the model can never reason off a stale screen.
  **Copied in spirit** (see Staleness); not copyable literally, because we do
  not own our transcript.
- **The allowlist's actual yield: 34 annotation sites, of which only ~9 ever
  reach the model.** 16 are on `<Tab>`, and `components/tabs.tsx:86-98` sets
  `key=` but never `id=`, so `getDomLlmHelp` silently `console.warn`s and drops
  every one. Three more lack an id outright. This is the empirical case for the
  issue's a11y-first decision: an opt-in allowlist keyed on a DOM `id` fails
  silently and stays failed for years.
- The tour half (`components/markdownwithtour.tsx`) turns *every* `#help=` link
  in a message into a multi-step `@reactour` spotlight. Rejected, per the
  issue. `lib/highlightelement.ts` — an unused, zero-caller absolute-positioned
  red ring with `pointerEvents: "none"` — is the shape we do want, and its
  deadness in memory-atlas is a fossil of the same fork we are taking the other
  side of.
- The DOM ids do double duty as the hardcoded onboarding tour's selectors
  (`components/onboarding.tsx:18-72`), which is why they were never given an
  indirection layer. We have no such coupling.

**Computing an accessible name in page JavaScript.** There is no shipped web
API for reading the computed accessibility tree from the page —
`getComputedAccessibleNode` is not available in any browser we target, and
Playwright's `_snapshotForAI` runs over CDP, outside the page. So the scan must
*approximate* accname. Two known options:

- `dom-accessibility-api` (npm) — the spec-accurate implementation
  `@testing-library/dom` uses. Not currently in the tree; `aria-query` is
  present only transitively via `eslint-plugin-jsx-a11y`. ~30 kB minified.
- Hand-rolled, following the accname fallback order for the cases this app
  actually produces.

Lean: hand-rolled (see Open design questions). No prior art found for a
"control pointer" URL scheme in a chat product beyond memory-atlas's fragment
form, which the issue already rejected with reasons.

**Native side.** SwiftUI exposes no runtime accessibility-tree query, and the
app sets **zero** `accessibilityIdentifier`s (26 a11y modifiers total, all
`accessibilityLabel`/`Hint`/`Value`). So a native inventory has to be declared,
not derived. No prior art found for a cross-platform control-address scheme.

## Tracks / scope

### Track 1 — The control model and the web scan

**What.** A frontend library that walks the live DOM and produces a typed list
of the interactive controls currently on screen, each with an address, a role,
an accessible name, an optional "what it does" line, and a flag for whether it
does. Plus the resolver that runs the other direction, from an address back to
a live element.

**Why this needs to change.** Nothing today can answer "what is on the user's
screen". `bin/browse snapshot` is a developer instrument driven over CDP
against the dev router; the deployed box agent has no browser
(`issues/features/2026-06-12-agent-browser-scoped-to-box.md`). The page's own
JavaScript is the only thing that can see the user's actual screen.

**Direction.**

New directory `src/frontend/src/lib/ui-scan/`.

```ts
export interface ControlEntry {
  /**
   * The element's `cb-`-prefixed DOM id. Null for a control that is on screen
   * but was never given one — such a control appears in the dump so the agent
   * knows it exists, but cannot be pointed at.
   */
  id: string | null;
  /** ARIA role, explicit or implicit from the tag. */
  role: string;
  /** Computed accessible name. Never empty — a nameless control is dropped. */
  name: string;
  /** Nearest named region/landmark, for grouping in the dump. */
  container: string | null;
  /** Author-written "what it does", from `data-cb-does`. Read live, so it may
   *  legitimately differ between scans as the control changes state. */
  does: string | null;
  /** Actions this control opts into, from `data-cb-reveal`. */
  actions: ControlAction[];
  /** Present and false for a control that is visible but not operable. */
  disabled: boolean;
}
```

**The address is an HTML `id`. Seen ≠ addressable.** A control is addressable
if and only if it carries a `cb-`-prefixed DOM id — `id="cb-composer-mic"` — a
hand-chosen, stable name **shared with the native shell**, so
`control:cb-composer-mic` means the same control whether the user is on the web
or in the iOS app. Roughly 25 controls get one (Track 4's table).

The identifier is the platform's own, not a bespoke attribute, and that buys
three things a `data-control` attribute would not:

- **Resolution is `document.getElementById`.** One call, browser-guaranteed, no
  selector escaping. (Hence kebab-case, not dots: `querySelector("#a.b")`
  parses as id `a` + class `b`.)
- **Uniqueness is already an HTML invariant with an existing checker.**
  axe-core 4.11.4 ships `duplicate-id`, `duplicate-id-active` and
  `duplicate-id-aria`, and `bin/tour --all` already runs axe over all ten
  routed pages at two viewports (`test/tours/tour-lib/axe.ts:29-33` suppresses
  only `color-contrast`). A duplicated address fails an instrument we already
  run, rather than a bespoke doctest this plan would have had to invent.
- **The namespace is clean.** There are 21 authored ids in the whole frontend,
  all kebab-case and semantic (`password-current`, `trash-card-title`,
  `delete-chat-title`), plus React `useId()` for generated label/control pairs
  in `ui/fields.tsx` and `ui/Accordion.tsx`. The `cb-` prefix separates
  *published addresses* from that internal a11y wiring, so the scan knows which
  ids are promises and which are plumbing.

This is not the rejected `#fragment`. The issue rejected fragments as the
*link syntax* — no room for `action`, and borrowing navigation semantics for
something that does not navigate. Using the element's id as its name while
keeping `control:` as the scheme takes the good half and none of the bad:
`control:cb-composer-mic` cannot be mistaken for an in-document anchor.

Everything else the scan sees is still **listed** in the dump, with its role,
name and container, and no address. The agent can say *"the pencil button at
the top right of the card panel"* — it just cannot hand out a tappable link for
it. This is the issue's requirement met exactly: everything visible by default,
annotation enriches, and an unannotated control degrades to its accessible
name. What it does not do is promise a link the app cannot reliably honour.

**Identity is authored and stable; name and description are read live and are
meant to change.** This split is the load-bearing idea, and it is what makes an
authored id cheap rather than a maintenance tax.

`InteractiveChat-voice-button.tsx:47` gives the mic a four-way computed
`title`:
``title={voicePaused ? "Resume recording (stops speech)" : isTranscribing ? "Stop recording" : narrationEnabled ? "Voice input (narration mode)" : "Voice input"}``
One element, one id, four names. Because the scan reads the accessible name and
`data-cb-does` at scan time, the dump says *"Stop recording — tap to stop and
send"* while the user is dictating and *"Voice input — hold to dictate; tap for
continuous"* when idle, off one annotation. The state-dependence that would
have wrecked a name-derived address is, once identity is decoupled from name,
the thing that makes the dump a report on **this moment** rather than a static
catalogue. Varying `data-cb-does` by state is therefore encouraged, not merely
tolerated.

The corollary is the annotation rule: **an id names a role in the interface,
not a component.** Two components that answer the same user question and can
never be in the document at once share an id — `NativeComposerView`'s
`trailingControl` swapping mic / send / stop is the model case. Two that can
coexist must not, and here "coexist" means *both in the DOM*, not *both
visible*: id uniqueness is a document-level rule, and a duplicate breaks
`getElementById`, `<label for>` and every `aria-*` reference, not just us.

That constraint immediately catches something. `DesktopComposerRow`
(`InteractiveChat-composer.tsx:58`, `hidden sm:flex`) and
`InteractiveChat-mobile-row.tsx` (`sm:hidden`) render the same four controls
and are **both mounted**, CSS-hidden by breakpoint. They are visually
exclusive, not DOM-exclusive, so they cannot share ids as they stand. Resolved
in the first chunk (below) rather than left as an open question — and worth
noting that the id approach *surfaced* it, where a private attribute would have
let two silent duplicates ship.

The alternative — deriving an address from role + name + container for
unannotated controls — was designed and cut, for the reason the mic makes
obvious: it needs authored overrides anyway, plus collision suffixes, plus a
re-scan-and-match resolver, to end up less reliable than the id it was
avoiding.

**Accessible name.** Computed in this order, stopping at the first non-empty
result: `aria-labelledby` → `aria-label` → `alt` (img/area/input[image]) →
visible text content (excluding `aria-hidden` subtrees) → `title` →
`placeholder`. A control that yields nothing is **dropped from the dump**, not
emitted with an empty name — it has no name the agent could use in prose and no
name the user could recognise. The count of dropped controls is reported in the
dump header, so the omission is visible rather than silent (principle 4).

`title` is above `placeholder` and below text content because 138 `title`
attributes carry real names here — the whole send/dictation cluster is
`title`-only (`InteractiveChat-composer.tsx:113,125`,
`InteractiveChat-voice-button.tsx:47`) — while the composer textarea has only
`placeholder="Type a message..."`.

**Visibility.** An element is in the scan when it is connected, has a non-zero
`getBoundingClientRect()`, is not `display:none` / `visibility:hidden` /
`opacity:0` on itself or any ancestor, has no `aria-hidden="true"` ancestor,
and is not inside a `[inert]` or `[hidden]` subtree. **Off-screen-but-mounted
is included** and marked — a control scrolled out of view is exactly what
`point` exists to scroll to. (memory-atlas excludes it,
`lib/isvisible.ts`; that is right for its spotlight and wrong for ours.)

**The same rule governs resolution**, not only the scan: the two live in one
module (`lib/ui-scan/visibility.ts`), applied downward by the walk and upward
along the ancestor chain by the resolver. An address that matches a mounted but
hidden element is a *third* resolve failure, `hidden`, rendered as a broken
pointer reading "this control is not currently visible". This is the everyday
case, not an edge one: both composer rows are mounted at every width, so
`cb-composer-send` and `cb-composer-send-mobile` are always one live address and
one hidden one. Without the check, a phone-width `reveal` of `cb-composer-send`
would synthetically click a `display:none` button and a `point` would ring
nothing.

`offscreen` remains viewport-relative only. A control scrolled out of an
`overflow: hidden` ancestor while its own box still falls inside the viewport
reports `offscreen: false`, so the dump can understate how hidden it is.
Testing every clipping ancestor would mean reading each one's overflow and box
on the way down — the cost the lazy `style()`/`rect()` seam exists to avoid —
and the consequence is bounded: `point` scrolls the element into view either
way, so the flag is imprecise, never a pointer that lands nowhere. Documented
rather than fixed (`scan.ts`, at the `offscreen` computation).

**What is scanned.** Interactive elements and landmarks only: elements matching
the focusable/widget-role set, plus `nav`/`main`/`header`/`footer`/`aside` and
anything with a landmark or `region` role. **Content headings and prose are
not scanned.** This keeps the dump about chrome, and it keeps the payload from
becoming an oblique copy of whatever card the user is reading — the agent
already learns that through `open-card`.

Excluding headings and prose is not enough on its own, because user content
holds *controls* too: the links in a rendered card, the buttons in an embed, a
custom view's own widgets. So the walk also stops at a **content boundary** —
`data-cb-scan="exclude"` on an element prunes its subtree exactly the way
`aria-hidden="true"` does. It goes on content roots and never on the chrome
around them; today that is the chat transcript (the message list itself, with
the load-older header and the scroll-to-bottom button outside it), the companion
pane's tab panels (the tab strip and close button stay in), the zoomed-view
overlay's body, and the peeked card inside a recent-files row. No `cb-` address
sits inside an excluded subtree. Excluded controls are **not counted** — an
omission the dump reports is one the agent could otherwise be misled by, while
this is a line the design drew, and "42 controls you may not see" would invite
exactly the guessing the boundary prevents. Duplicate-address detection is the
one pass that still covers the whole document: a repeated `cb-` id anywhere
breaks `getElementById` wherever it lives. This boundary is what makes "the
scan returns chrome" — the reason Track 3 asks for no consent prompt — a
property of the code rather than of where the user happens to be looking.

**Enrichment.** `data-cb-does="opens the attach menu — capture, file, upload,
screenshot, share location"`. An attribute on the element, not a registry keyed
by id, for one reason: **a description that lives on the element cannot be
orphaned by a rename.** It moves with the control or it is deleted with it. It
is also free to be a computed expression, which is what makes state-dependent
descriptions natural rather than a special case. There is nothing for a `doc-check`-style guard to check, because there
is no reference that can dangle. (Content staleness remains, in the same class
as a stale code comment; the answer there is review, not tooling.)

Enrichment is scoped, not open-ended: **annotate disclosure controls first.**
The scan can only see what is currently on screen, so the contents of a closed
menu are invisible to it by construction. `data-cb-does` on the trigger is
how "capture, file, upload, screenshot, share location" reaches the agent at
all. Everything else degrades to its accessible name, per the issue.

**The reveal/do boundary: opt-in, not inferred.** `reveal` is the only action
that dispatches a synthetic click, so it is the only place the "reveal it,
don't do it for them" line can be crossed. It requires an explicit opt-in:

```tsx
id="cb-composer-add" data-cb-reveal
```

meaning *the author asserts that clicking this control only changes what is
disclosed*. A control without the attribute is never clicked, whatever its
markup says. `actions` on the entry is `["point", "focus"]` by default and
gains `"reveal"` only from the attribute.

An earlier draft inferred this from `aria-expanded` / `aria-haspopup` /
`role="tab"` and claimed it was enforcement by construction. That claim is
false, and the codebase disproves it: `role="tab"` on `TabBar.tsx:34` fires
`onChange`, and the companion-pane tabs at `InteractiveChat-controls.tsx:176`
switch which file the user is looking at. ARIA describes interaction semantics;
it does not classify an action as safe. Inference here would have been a
guess dressed as a guarantee, which is worse than no guarantee at all
(principle 4, and principle 11 — the enforcement has to be real).

The ARIA check survives as a **secondary** requirement, not the basis: a
control carrying `data-cb-reveal` must also present `aria-expanded`,
`aria-haspopup` or `role="tab"`, asserted by a doctest over the annotated set.
That catches an author who tags a control that has no disclosure semantics at
all, and it keeps the a11y layer and this feature reinforcing each other as the
issue argues — it just no longer stands alone.

**Resolution** is `document.getElementById(id)` against the live DOM, after
checking the id carries the `cb-` prefix. No match is a failure that renders
broken; a *duplicate* cannot be detected this way (`getElementById` returns the
first in document order), which is precisely why uniqueness is enforced
upstream by axe in the tours rather than at resolve time. The scan, which walks
the document anyway, reports any duplicated `cb-` id in its header as a second
line of defence. Fails closed, like `resolveRefPath` (`src/shared/ref-path.ts`).

**Vocabulary lock-ins.** The `cb-` id prefix, `data-cb-does`, `data-cb-reveal`,
the kebab-case id form, the action names `point` / `focus` / `reveal`, and the
`control:` scheme. All of these cross into iOS and, later,
Android; renaming any of them afterwards is a bridge-contract migration.

**First implementation chunk.** `src/frontend/src/lib/ui-scan/scan.ts` +
`accessible-name.ts` with pure-function doctests; resolving the
desktop/mobile composer-row duplication (see below); then the ids and
`data-cb-*` attributes on the ~25 chat-surface controls in Track 4's inventory,
with `bin/tour --all` run to confirm axe reports no duplicate id. No route, no
CLI, no link rendering yet.

**The composer-row duplication, decided.** Three options were considered:
distinct ids per breakpoint (`cb-composer-send` / `cb-composer-send-mobile` —
rejected: the agent sees two sends and must guess which the user can reach);
resolve-the-visible-one (rejected: gives up `getElementById`, re-admits
duplicate ids, and leaves the HTML invalid); or render one row instead of two.
**The last one.** `DesktopComposerRow` and `InteractiveChat-mobile-row` already
render the same four controls with the same handlers and differ in arrangement;
collapsing them to one row whose *layout* is responsive removes a real
duplication rather than working around it. If that refactor proves larger than
it looks once opened, the fallback is distinct ids plus a dump note naming
which is reachable at the current viewport — recorded here so the chunk cannot
stall on a decision.

**Opened, and the fallback was taken (2026-08-23).** The premise above is wrong
on the facts, in three ways the plan could not see from the line citations:

- **The rows are not both-always-mounted.** `MobileTextareaRow` mounts only
  when `typingMode || isTranscribing` (`InteractiveChat-layout.tsx:168`), and
  it lives *below* the whole `<section aria-label="Compose message">`, inside a
  conditional wrapper that also carries the lock / close-keyboard overlay.
  `DesktopComposerRow` lives *inside* that section's flex row, between the
  capture button and the voice button. One element cannot occupy both parents;
  a responsive-layout unification would have to restructure the section itself.
- **They differ in behaviour, not only arrangement.** Desktop's textarea takes
  `enterKeyHint="send"` and `onKeyDown={handleKeyDown}` (Enter sends) at
  `minRows={1}`; mobile's takes `enterKeyHint="enter"`, no key handler (Enter
  inserts a newline) at `minRows={2}`, and owns its own ref plus
  `useTranscriptAutoscroll` (desktop's autoscroll is wired in `useChatActions`).
- **The transcription handlers differ.** Desktop's "Edit before sending" and
  segment-send call `transcription.cancel()` and read
  `transcription.transcript` synchronously; mobile's call
  `await transcription.stop()` and send the *returned* final text. Unifying
  means choosing one, which is a dictation-semantics decision, not a layout one.

So: distinct ids per breakpoint — `cb-composer-input-mobile` and
`cb-composer-send-mobile` alongside the desktop `cb-composer-input` /
`cb-composer-send`. The dump note naming which is reachable at the current
viewport lands with the dump (Track 3). The unification remains worth doing on
its own merits; it is a separate piece of work with its own decisions to make.

### Track 2 — The pointer: `control:` links

**What.** `control:` becomes a recognised markdown href kind that renders as an
icon-marked inline reference and, on click, acts on the live interface.

**Why this needs to change.** The agent has no way to indicate an element. The
seam for one exists and currently sends `control:` down the `external` branch
(`view-url.ts:161` — any `[a-z][\w+.-]*:` prefix is external), so today it
would render as a dead `<a href="control:…">`.

**Direction.**

```markdown
[the mic](control:cb-composer-mic?action=point&description=Tap%20and%20talk)
```

- `action` — optional, `point` by default. `point | focus | reveal`.
- `description` — optional, agent-authored, shown beside the link.

`classifyMarkdownHref` gains a member:

```ts
| { kind: "control"; id: string; action: ControlAction; description: string | null }
```

parsed with `URLSearchParams` on the part after `?`. An unknown `action` value
classifies as `control` with the action set to `point` and a note that the
requested action was not understood — the pointer still works, degraded, rather
than the whole link dying over a typo. An empty id classifies as `external`
(the existing malformed-input path). The `kind` switch in `makeLink` lists
every case with no `default:`, per the frontend exhaustiveness rule.

Rendered by a new `ControlPointer` in
`src/frontend/src/components/ControlPointer.tsx`: the link text, a leading icon
that marks it as acting-on-the-interface rather than navigating, and the
`description` beside it. It lives in the shared `makeLink`, not a chat-only
override — the controls it addresses are app chrome, which is present wherever
the app renders markdown, and a second rendering path would violate principle
8.

**What each action does.**

| action | behaviour | changes app state? |
|---|---|---|
| `point` | scroll into view if needed, then draw a ring around the element's box for ~2s | no |
| `focus` | `point`, then `element.focus()` | focus only |
| `reveal` | `point`, then click **iff** the target carries `data-cb-reveal` | disclosure only |

The ring is an absolutely-positioned overlay with `pointer-events: none`,
removed on a timer, honouring `prefers-reduced-motion` by drawing a static ring
with no pulse. No mask, no popover, no modal layer — the reason for rejecting
the tour was that it takes over the screen, and a mask is the part that does
that. This is memory-atlas's unused `lib/highlightelement.ts` shape, which lost
there to reactour and wins here.

**When it cannot resolve**, the pointer takes the `BrokenLink` treatment —
`Markdown.tsx:150-156`, *"renders as a visibly-disabled marker with the reason
in its tooltip, so the content reads as broken-on-sight."* A control that
unmounted, or belongs to a page the user has since left, is the **normal**
failure here, not an exceptional one, which is why it gets the established
visible treatment rather than an inert no-op (principle 4; `code-style.md`
"user-initiated actions never silently no-op").

**This is not free reuse, and the plan should not pretend otherwise.**
`BrokenLink` today is a module-private function in `Markdown.tsx`, chosen
during render from a *static* classification: a `view:` href and a
box-escaping path are broken the same way forever. A `control:` pointer's
validity is live state — the same link is fine while the chat is open and
broken after the user navigates. So two changes are needed:

- **Move `BrokenLink` into a shared module** (`components/ui/BrokenLink.tsx`)
  and import it from both `Markdown.tsx` and `ControlPointer`. It is
  presentation only, so this is a move, not a redesign.
- **`ControlPointer` is stateful.** It resolves on mount and re-resolves on a
  cheap trigger — a `MutationObserver` watching `id` attribute and childList
  changes, debounced — so a pointer that has gone dead *looks* dead
  without the user clicking it. That is what "broken-on-sight" has to mean
  here; a link that only reveals its brokenness on click is exactly the silent
  failure the treatment exists to avoid.
- **A click that fails at the last moment** (resolved a frame ago, gone now)
  flips the same component to its broken state in place and does not navigate,
  toast, or no-op silently.

The tooltip names the id and says whether it matched nothing or matched more
than one element.

**Vocabulary lock-ins.** The scheme name `control:`, the param names `action`
and `description`, and the three action values.

**First implementation chunk.** `classifyMarkdownHref` + its doctest,
`ControlPointer`, the three action behaviours, and the ring overlay. Testable
end to end by hand-writing a `control:` link into a card body before any agent
can produce one.

### Track 3 — The round trip: `cb chat ui`

**What.** A CLI command the agent runs that asks the user's connected client
for its current control inventory and prints it.

**Why this needs to change.** The agent runs server-side with no browser. The
inventory only exists in the client.

**Direction.** A direct sibling of the screenshot flow.

- `POST /<box>/api/chat/ui/request` — long-poll from the CLI. Loopback-guarded
  with `verifyAgentBearer` and 403 for a plain user session, exactly as
  `chat-screenshot-routes.ts` does, *"the flow is agent-initiated, so an
  ordinary authenticated/open-access user must not be able to start a
  request."*
- `POST /<box>/api/chat/ui/:requestId` — the client's answer, user-session
  authed. JSON: `{ack:true}` | `{entries, coverage, channel, url}` |
  `{failed:"…"}`.
- The rendezvous is `createPendingBrowserRequests<UiScanFulfillment>` with the
  same 2 s ack window, so `no-client` and `timeout` stay honestly distinct.
- `cb chat ui` in `src/cli/commands/chat.ts`, `--session`, `--timeout`, and the
  same outcome switch.

**No consent prompt.** The screenshot flow has one
(`ScreenshotConsentPopup.tsx`) because a screenshot captures whatever content
is on screen. This returns chrome: roles, control labels, and author-written
descriptions. The few user-derived strings in it — the session title on
`SessionChip`, the box name on `PlacePill`, open companion-pane tab labels —
are things the agent already receives via `open-card` and the session it is
running in. Flagged in Open design questions as a judgment call the boxholder
should confirm rather than one this plan should make alone.

**The dump format**, printed to stdout, using the tours' `role "name"` idiom so
an agent that has read an `.ax.txt` can read this:

```
UI on screen — web-desktop, /main/test1/chat, scanned 14:32 local
Covers: browser DOM only. This surface has no native chrome.
3 controls omitted: no accessible name.

navigation "Primary"
  button [Place: test1](control:cb-nav-place)
  button [Session: Dinner plans](control:cb-nav-session) [reveal]
    — the thread menu: new session, recent chats, model, delete this chat
  button [Voice input (narration mode)](control:cb-nav-voice) [reveal]
    — mute and narration toggles, and voice settings
  button "Open debug log (2 errors)"                    (no address)
region "Compose message"
  button [Add](control:cb-composer-add) [reveal]
    — the attach menu: capture, attach file, upload files, screenshot,
      share location
  textbox [Type a message...](control:cb-composer-input)
  button [Send](control:cb-composer-send)
  button [Stop recording](control:cb-composer-mic)
    — tap to stop dictating and send; say "cancel message" to discard
tablist "Open files"
  tab "Dinner_Plans.doc.card"                           (no address)

To point the user at one of these, write its link into your reply:
[the mic](control:cb-composer-mic?action=point&description=tap%20and%20talk).
`action` is `point` (default), `focus`, or `reveal` — `reveal` is available
only on a control marked `[reveal]`, and it opens the control; it never acts
for the user. A control shown as `(no address)` is on screen but has no link —
describe it in words instead of inventing an address for it.
```

Presenting each control as the link the agent should write back is memory-atlas's
idea, copied deliberately (`domhelprepresentation.ts:1-19`).

**Snapshot per turn, or on demand.** On demand only, and this is the strongest
evidence in the plan. Our `<chat-app>` snapshot is prepended to the user
message *text* and never rewritten
(`src/core/chat/session/start.ts:178`); there is no collapse mechanism anywhere
in the codebase. So a per-turn dump of ~50 lines would be permanently resident
once per turn — tens of thousands of tokens of dead, increasingly-wrong context
in a long conversation. memory-atlas can afford per-message injection precisely
because it owns its transcript and drops each copy after one following user
message (`gptserialize.ts:337-352`); we own neither half of that.

The agent does not need a per-turn hint to know the capability exists: the
prompt tells it, and the command reports `no-client` when nothing is attached.
The one thing it does need is Track 5's corrected `channel` attribute, because "where is
the mic" has different answers on web and in the iOS app.

**Vocabulary lock-ins.** The route paths, the fulfillment JSON shape, and the
dump's line format.

**First implementation chunk.** The route pair with its Zod schemas and route
doctests, the client-side request handler, and the CLI command.

### Track 4 — Annotation pass, prompt convention, and audits

**What.** Put `cb-` ids, `data-cb-does` and `data-cb-reveal` on the controls
that matter, document the convention where the agent reads conventions, and
verify it absorbed it.

**Why this needs to change.** An unannotated app still produces a dump, but the
disclosure controls — the ones whose contents the agent cannot see — carry no
description, which is the half that answers "how do I do X".

**Direction.**

Authored ids, chosen so web and native agree (Track 5 uses the same strings):

| id | web (`id=`) | native iOS (`accessibilityIdentifier`) |
|---|---|---|
| `cb-nav-place` | `PlacePill.tsx:195` | — |
| `cb-nav-session` | `SessionChip.tsx:206` | — |
| `cb-nav-voice` | `VoiceChip.tsx:228` | — |
| `cb-nav-profile` | `AppNav.tsx:44-58` | — |
| `cb-nav-todo` / `cb-nav-errors` | `AppNav.tsx:168,187` | — |
| `cb-composer-add` | `InteractiveChat-composer.tsx:208` | `ComposerActionsView` trigger |
| `cb-composer-input` | `InteractiveChat-composer.tsx:60` | `ComposerTextView.swift:30` |
| `cb-composer-send` | `InteractiveChat-composer.tsx:121` | `NativeComposerView.swift:361` |
| `cb-composer-input-mobile` | `InteractiveChat-mobile-row.tsx:47` | — (breakpoint fallback; see Track 1) |
| `cb-composer-send-mobile` | `InteractiveChat-mobile-row.tsx:116` | — (breakpoint fallback; see Track 1) |
| `cb-composer-mic` | `InteractiveChat-voice-button.tsx:28` | `NativeComposerView.swift:386` |
| `cb-composer-capture` | `InteractiveChat-composer.tsx:238` | `NativeCaptureView` entry |
| `cb-composer-stop-dictation` | — (web has no separate control) | `NativeComposerView.swift:354` "Stop continuous dictation" |
| `cb-chat-stop-agent` | `TargetStrip.tsx:53` "Stop agent" | — |
| `cb-chat-stop-speech` | `TargetStrip.tsx:43` "Stop speaking" | — |
| `cb-panel-tabs` / `cb-panel-close` | `InteractiveChat-controls.tsx:163,209` | — |

An id means the same control on both platforms or it is not shared. An earlier
draft mapped one `cb-composer-stop` onto web `TargetStrip.tsx:53` (*"Stop agent"*,
shown while streaming) and native `NativeComposerView.swift:354` (*"Stop
continuous dictation"*) — two unrelated controls under one name, which would
have shipped the shared-id contract already broken. They are separate ids
above, and a `—` in a column is the honest answer: the platform has no
counterpart, so the agent gets `no such control on this surface` rather than a
pointer at the wrong thing.

`data-cb-does` goes on every `[reveal]` control in that table plus the mic,
whose behaviour (tap versus hold, and the spoken keywords) is not inferable
from a label; the mic's is a computed expression, so the description tracks its
four states the way its `title` already does. `data-cb-reveal` goes on
`cb-nav-session`, `cb-nav-voice`, `cb-nav-profile` and `cb-composer-add` — the
four menu triggers — and nothing else in this pass.

**On iOS the same string is the `accessibilityIdentifier`.** That field is the
platform's own stable-handle mechanism, it is currently unused (the app has 26
accessibility modifiers, all `Label`/`Hint`/`Value`, and zero identifiers), and
it is what XCUITest addresses views by — so annotating buys UI-test
addressability as a side effect. `.controlAnchor(...)` sets it and registers
the entry in one call, keeping the two from drifting.

Prompt text lands in `src/core/chat/session/prompts.ts`, in the existing
"Showing things in chat" section, directly after the card-path link paragraph —
so the two kinds of pointing are read as one vocabulary with one rule:

> **A path points at content. `control:` points at the interface.** If the
> thing has a place in the box, link its path. If it exists only on screen — a
> button, a menu, a field — run `cb chat ui` and link its `control:` address.
> You may `point` at a control, `focus` it, or `reveal` what it opens. You
> never operate it for the user: revealing the attach menu is helping; attaching
> the file is doing it for them, and is not yours to do. **Never name a screen
> location you have not seen in a dump** — not in passing, not "it's in your
> sidebar now." If you have not looked, say what the thing is and link it.

The last sentence is the one a user journey on 2026-08-23 showed to matter
most: a first-time user was told an area was "in your sidebar" on a page with
no sidebar, by an agent volunteering a location inside a sentence about
something else. On-demand scanning fixes the case where location *is* the
question; only the prohibition fixes the case where the agent asserts one
unasked. It lands early, in the agent guide (`behavior.ts`, committed
`7d34f0ef`), and this paragraph extends it with the way to look.

A pointer to `cb chat ui` also goes in `src/core/box/skills-content.ts`,
alongside the existing `cb chat screenshot` sentence
(`skills-content.ts:455`), phrased the same way: reach for it when interface
location is genuinely the question, not by reflex.

**Vocabulary lock-ins.** Every authored id in the table above.

**First implementation chunk.** The ids and `data-cb-*` attributes, and the
prompt section. The audits follow once Tracks 1-3 are runnable.

### Track 5 — iOS: the half that matters most

**What.** The iOS shell contributes its native controls to the scan and draws
the ring on them, and the agent is told which surface it is talking to.

**Why this needs to change.** This is not an edge case. The native shell loads
the chat with `nativeComposer=1` (`ios-app/CallbackBox/Models/PairedBox.swift:47-50`,
*"Keep this query parameter in sync with ChatPage's nativeComposer search
option"*); `ChatPage.tsx:126-130` reads it — or, after an in-app navigation
drops the param, detects the bridge directly — and
`InteractiveChat-view.tsx:339` suppresses the web composer. So **the DOM inside
the webview is the transcript and nothing else**. Every control in the job
stories above — mic, send, add, capture, box switcher, narration — is SwiftUI.
A DOM-only scan on a phone returns almost nothing while looking like a complete
answer, which is the precise failure the issue names. And the phone is where
the job story lives.

**Direction.**

**A native control registry, populated by view modifiers.** SwiftUI cannot be
walked, so native entries are declared — but declared *in the view body*, so
they cannot drift from what is rendered:

```swift
.controlAnchor("cb-composer-mic", does: "hold to dictate; tap for continuous dictation")
```

The modifier registers `(id, label, does, frame)` into an environment-held
registry while the view is on screen and removes it on disappear. Because
`NativeComposerView.trailingControl` (`NativeComposerView.swift:347-384`) is
already a state machine that renders mic *or* send *or* stop, the registry is
automatically state-correct — the same property the DOM scan gets for free.
The same registry serves both directions: the scan reads it, and pointing looks
up the frame to draw the ring.

**A command envelope V2, not two enum members.** The existing command is not
extensible as it stands, and calling it "the extension point" understates the
work. `NativeComposerCommand` (`NativeComposerContract.swift:65-100`) declares
`var selection: Selection` **non-optional** and decodes it unconditionally
(`selection = try container.decode(...)`), so any command that is not an
`add-selection` fails to decode. And the return path cannot carry data at all:
`NativeComposerCommandAcknowledgement` is `{version, id, accepted, reason?}`
(`NativeComposerContract.swift:108-150`) — enough to say *no, because*, not
enough to return an inventory.

So Track 5 lands:

- **`NativeComposerCommand` V2** with `kind` discriminating a `payload` union —
  `addSelection(Selection)` / `scanControls` / `pointAtControl(id, action)` —
  keeping V1 decodable so an old web bundle talking to a new app still works.
  Mirrored in `src/frontend/src/components/chat/native-composer-command.ts`.
- **A result channel**: either `NativeComposerCommandAcknowledgement` gains an
  optional typed `result` payload, or a sibling `callbackboxNativeCommandResult`
  global is added beside the existing ack global. The ack stays what it is —
  accepted/rejected — and the result is separate, so a rejection with a reason
  and a successful empty result stay distinguishable.

Web→native rides `window.callbackboxNativePost` with a string payload, which is
the Android-compatible shape the Android plan fixed in Track 0.

**Merging.** The web scan handler, when the native bridge is present, requests
`scan-controls`, waits up to ~1.5 s, and merges native entries into the
inventory. If native does not answer in time, the dump's coverage line says so
in the payload the agent reads:

```
Covers: browser DOM. Native chrome did NOT respond — the composer, mic,
capture and box switcher are not in this list and may still be on screen.
```

Never a short list presented as a complete one (principle 4). The `coverage`
field is a closed union — `"dom"` | `"dom+native"` | `"dom-native-unavailable"`
— not a free string.

**Pointing at a native control** from a `control:` link: the web resolver finds
no DOM match for `cb-composer-mic`, sees the bridge is present, and sends
`point-at-control`. Native draws the ring, or rejects with a reason, and the
rejection turns the pointer into a `BrokenLink` carrying that reason. `focus`
and `reveal` map onto native focus and sheet presentation where they exist and
are rejected with a reason where they do not; the web side must not assume
symmetry.

**Surface reporting — fix `channel`, don't add a sibling.** The existing
`<chat-app channel>` attribute already answers "what is the user looking at";
an earlier draft added a parallel `surface` attribute with an overlapping value
set, which is two vocabularies for one fact. Instead `channel` changes in
three ways: its values become a closed union
`"web-desktop" | "web-mobile" | "ios-native"` (today it is an open `string`,
`chat-helpers.ts:125`); `"ios-native"` is the new member; and **the client
sends it** instead of the server guessing it from the user-agent
(`chat-send-routes.ts:241` → `classifyChannel`), because only the client knows
whether the native shell is in effect (`ChatPage.tsx:126-130`). The UA
classification stays as the fallback for a client that sends nothing, so an
old web bundle keeps reporting what it reports today.

It is one attribute and five touchpoints in the code, which the plan should
say out loud rather than call cheap: the send-body Zod schema in
`chat-helpers.ts`; the `channel` field on `ChatSendInput`
(`src/core/chat/session/messages.ts`) narrowing from `string` to the union;
latest-wins merging in `combineQueuedInputs` (`src/core/chat/session/state.ts`),
already there for `channel`; `contextAttrs` **and** `READ_ONLY_ATTRS` in
`src/core/chat/features.ts` (a context attribute the agent must not be able
to set via a delta); and the client-side send plumbing through `api-chat.ts`
and the chat machine. That is the same path `openCard` already walks, so it is
well-trodden, not novel. The prompt sentence for `channel`
(`prompts.ts:103`) gains the third value and what it implies: on `ios-native`
the composer, mic and capture are native chrome, not in the DOM.

This is also the attribute
`issues/features/2026-08-13-tell-the-agent-the-screen-is-unfocused.md` will
sit beside; the two should not invent separate vocabularies for "what the user
is looking at".

**Contract discipline.** `bin/mobile-contract-check.ts` enforces that a commit
touching a listed anchor updates `docs/mobile-contract.md` in the same commit
(anchor manifest at `mobile-contract.md:868-902`). The V2 command envelope, the
result channel, the native registry, and the new snapshot attribute all land
with §3.3, §7, §8 and §11
updates and golden fixtures under `test/mobile-contract/fixtures/`. The
DEBUG-only composer fixture screens (`NativeComposerFixtureScreen.swift`, the
`--composer-fixture=` launch args) are the existing harness for exercising
native chrome without a server, and the registry gets fixture coverage there.

**Android.** Out of scope to build, in scope not to block: everything above
rides `callbackboxNativePost` with string payloads, so the Android shell can
implement the same two kinds. Note the asymmetry the Android plan records —
`evaluateJavascript`'s callback has no error parameter there
(`docs/plans/android-companion-app.md:447-454`) — so the native→web ack must
carry its own sentinel rather than relying on eval failure.

**Vocabulary lock-ins.** `scan-controls`, `point-at-control`, the
`coverage` union, the `channel` attribute values, and every shared authored id
from Track 4's table.

**First implementation chunk.** The `channel` fix end to end (client →
route → `<chat-app>` → prompt), which is independently useful and is the
smallest piece that removes the "iOS looks like mobile web" lie.

## Could this be simpler?

**The simplest version that could plausibly work.** A hand-written TypeScript
constant listing ~20 controls with an id, a label, a CSS selector and a
description. `cb chat ui` prints it, filtered by which selectors currently
match a visible element. `control:<id>` resolves by
`document.querySelector(entry.selector)`. No accname computation, no
annotations, no role walk, no dump of anything the list does not name. Perhaps
150 lines against the plan's several hundred, and it would answer the three job
stories on the web today.

After the cross-model review this plan moved substantially toward that shape:
addresses are now authored-only, so the remaining difference is that the scan
*reads the live DOM* rather than trusting a constant.

**What the fuller approach buys, concretely.**

1. **Coverage that does not silently rot.** memory-atlas is the controlled
   experiment: 34 hand-maintained annotations, ~9 of which the model ever sees,
   with 16 lost to a missing `id=` in `components/tabs.tsx:86-98` that has
   warned to the console for years. A curated list *is* the simple version, and
   its observed failure mode is silent under-coverage. Traces to principle 4 —
   the failure has to be visible, and "the agent just did not mention that
   button" never is.
2. **State correctness.** A selector list cannot express that the trailing
   composer control is a mic, a send arrow, a stop button, or a spinner
   depending on four pieces of state. Reading the live DOM gets that for free;
   maintaining it by hand gets it wrong. This is also why native uses a
   view-body registry rather than a static array.
3. **Descriptions that cannot orphan.** In the simple version the description
   sits in a constant next to a selector; rename the class or restructure the
   markup and it points at nothing, or worse, at something else. On the element
   it cannot.

**What it does not buy, and where the plan should stay small.** Listing
unaddressable controls is now the part most at risk of being noise. It exists
to satisfy a decided requirement — everything visible by default, unannotated
controls degrade to their accessible name — and it is nearly free once the walk
and accname exist. If the long tail proves to be clutter, the retreat is a flag
on the dump that prints addressable controls only, not more machinery.
Recorded here so the next reader knows which knob to turn first.

The plan deliberately does **not** add: a registry keyed by id (rejected above),
a `doc-check`-style staleness guard (there is no reference that can dangle), a
mid-turn push channel, or any modal layer.

## Subplans

None. Track 5 is the largest and most likely candidate — it spans a Swift
registry, two bridge command kinds, and a contract update — but it has no
open design questions of its own: the extension point, the transport, the ack
semantics and the fixture harness all already exist and are cited above. If
Track 5's first chunk turns up a genuine decision (most likely around what
`focus` and `reveal` mean on a SwiftUI sheet), it becomes
`agent-points-at-ui.ios.subplan.md` and the parent waits for it.

## Failure modes

**Critical gap:** none unresolved. Two were found and are addressed in the
plan; both are recorded in the table.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Agent writes `control:` with an id that has unmounted or scrolled out of a virtualised list | Yes — `ControlPointer` component doctest for the zero-match path | Yes — resolver returns zero matches → `BrokenLink` with the id in the tooltip | Clear |
| Two elements carry the same `cb-` id (a component rendered twice, e.g. the desktop and mobile composer rows both mounted) | Yes — axe `duplicate-id` in `bin/tour --all`, which already runs on every routed page; plus a scan doctest asserting the dump header names the duplicate | Partial at runtime — `getElementById` silently returns the first in document order — so this is caught upstream at annotation time, not at resolve time | Clear in the tour report; **silent at click time** — accepted, and it is why the annotation pass ends with a tour run |
| A `control:` pointer resolves to a mounted-but-CSS-hidden element (the other half of the responsive composer pair, at the wrong width) | Yes — doctests over `resolveVisibleControl` at both widths | Yes — `hidden` resolve failure → `BrokenLink` reading "this control is not currently visible" | Clear |
| A control becomes hidden without the DOM tree changing (the viewport crosses a breakpoint) while a pointer is on screen | Partly — the resolve+visibility doctests, not the observer | Partial — the `MutationObserver` watches `childList` + `id`, so the pointer keeps reading `ok` until it is clicked, at which point it re-resolves and flips to broken in place | Clear at click, silent until then — accepted; a pointer that acts on a hidden control is what mattered |
| A rendered card, embed or transcript message puts its own links and buttons into the dump | Yes — scan doctest over an excluded subtree | Yes — `data-cb-scan="exclude"` prunes content roots; the annotated chrome is all outside them | Clear (by construction — the payload is chrome) |
| A control is clipped out of view by an `overflow: hidden` ancestor but its own box is inside the viewport | No | Partial — reported as on screen; `point` scrolls it into view regardless | Silent — accepted and documented at the `offscreen` computation |
| Native bridge does not answer `scan-controls` in time | Yes — route doctest with a fake bridge that never answers | Yes — `coverage: "dom-native-unavailable"` and an explicit sentence in the dump | Clear |
| Native bridge does not answer `point-at-control` in time | Yes — doctest with a bridge that never answers | Yes — the pointer takes the `BrokenLink` treatment saying the app did not answer in time (not "refused" — the ring may well have been drawn and the reply lost) | Clear |
| A `control:` link names a native control the shell does not have, or asks it for an action it cannot perform | Yes — doctest for each refusal shape, XCTest for each refusal sentence | Yes — native refuses with a sentence; the pointer becomes broken in place carrying it | Clear |
| The registry's frame for a control is stale (it moved without an appear or a layout change) | Yes — XCTest over a zero frame | Yes — refused rather than ringing the wrong place, which is the accepted lower-fidelity trade for a declared registry | Clear |
| A native control inside a child-raised sheet is pointed at, so the ring is drawn under that sheet | No | No — the ring is `RootView`'s, and the sheet is above it | Silent — accepted; the webview holding the link is covered by the same sheet, so the link cannot be tapped then. Recorded in `docs/mobile-contract.md` §4.8 |
| No client attached when the agent runs `cb chat ui` (phone locked, tab closed) | Yes — route doctest via the existing ack-window path | Yes — `no-client`, distinct from `timeout`, inherited from `pending-browser-request.ts:11-18` | Clear |
| Accname computation returns empty for a control that is genuinely important | Partly — doctests cover the fallback chain, not "was this one important" | Dropped from the dump, but the drop **count** is printed in the header | Clear (count), silent (which) — accepted; see below |
| An author puts `data-cb-reveal` on a control that does more than disclose | Yes — a doctest asserting every `data-cb-reveal` element also presents `aria-expanded`/`aria-haspopup`/`role="tab"` | Partial — the doctest catches the missing-semantics case, not a genuinely mislabelled disclosure control | Silent — accepted, and it is why the attribute is opt-in and confined to four menu triggers in this pass |
| A `Dropdown` caller forgets to spread `ariaProps`, so its trigger has no `aria-expanded` | Yes — a tour assertion that every `Dropdown` trigger exposes `aria-haspopup` | Yes — the `data-cb-reveal` doctest fails, so the annotation cannot land | Clear |
| Scan payload is malformed or hostile (a compromised/old client) | Yes — route doctest with a bad body | Yes — Zod `strict()` schema at the route, per principle 3 | Clear |
| Dump is large enough to matter (a page with 200 controls) | Yes — scan doctest asserting the cap | Yes — hard cap on entries, with the truncation stated in the header and the omitted count given | Clear |
| Agent uses a dump from earlier in the conversation after the user navigated | No — not mechanically detectable server-side | Partial — the dump header carries the scan time and the URL; the pointer breaks visibly at click time | Clear at click, silent in the agent's reasoning — accepted; see Staleness |
| A `control:` link appears in a card body rendered outside the app shell (an export, a published page) | Yes — `classifyMarkdownHref` doctest | Yes — no resolver present → `BrokenLink` | Clear |

**The two accepted silences, stated plainly.** First, the dump reports *how
many* named-less controls it dropped but not *which* — naming them would
require inventing a name, which is exactly the fabrication the enrichment layer
exists to avoid. The tours already surface unnamed controls as a11y findings;
that is the right place to fix them. Second, an agent can reason from a dump
that has gone stale mid-conversation. The pointer it writes will break visibly
when clicked, which bounds the damage to a wrong sentence rather than a wrong
highlight — the outcome the issue asks for.

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong pointer kind** — agent writes `control:` for something
  that has a card path, or a path for a button. **ADDRESSED**: Track 4's prompt
  text states the rule as a single sentence pair ("A path points at content.
  `control:` points at the interface") in the same section as the existing
  path-link convention, and the dump only ever offers `control:` addresses for
  things that have no path.
- **Stale ref** — the control moved or unmounted between write and click.
  **ADDRESSED**: Track 2, resolution at click time against the live DOM, with
  `BrokenLink` on failure. This is the *normal* case here, not the exception,
  and is designed for rather than defended against.
- **Two agents touching the same thing** — not applicable. The inventory is
  read-only and derived from the client's DOM; there is no shared writable
  state. **ADDRESSED** by absence.
- **Hand-edit drift** — the boxholder writes a `control:` link by hand into a
  card with a wrong id or a mistyped action. **ADDRESSED**: an unknown id
  renders as `BrokenLink`; an unknown `action` degrades to `point` rather than
  killing the link (Track 2).
- **Fabricated free-form value** — the agent invents a `description=`, or worse
  invents a control id it never saw in a dump. **ADDRESSED, partly by
  construction**: an invented id cannot resolve, so it renders broken instead of
  highlighting the wrong thing. `description` is agent-authored by design (it is
  why the param exists), so a wrong one is a wrong sentence, not a wrong
  action. The design makes honesty easy in the direction that matters: the
  agent cannot describe a control that is not on screen without the pointer
  visibly failing.
- **Validation error UX** — `cb chat ui` fails. **ADDRESSED**: the CLI reuses
  the screenshot command's outcome vocabulary verbatim
  (`chat.ts:255-273`), which already reads well in an agent's context —
  `no-client: no browser is attached to this chat session` tells the agent both
  what happened and that retrying will not help.
- **Partial migration / transition state** — a user on an old cached web bundle
  answers a scan request from a new server, or an old iOS build receives
  `scan-controls`. **ADDRESSED**: an old web client does not recognise the
  request and never acks, so the request resolves `no-client` rather than
  hanging or half-answering. An old iOS build throws
  cannot decode the command at all — `receiveComposerCommand`
  (`ChatWebView.swift:591-601`) wraps the decode in `try?`, so it answers with
  a *rejection carrying a reason* when the payload has an `id`, and returns
  **silently** when it does not. The web side therefore treats "no result
  within the wait" identically to an explicit rejection and reports
  `coverage: "dom-native-unavailable"`. (An earlier draft claimed the old
  build would surface `DecodeError.unsupportedVersion`; the `try?` erases it,
  and that error would only fire on a `version` bump, not on an unknown
  `kind`. The observable outcome is the same, but the mechanism written down
  was wrong, so the V2 envelope must always carry a non-empty `id` — that is
  what keeps the failure loud rather than silent.)
- **Voice** — the user cannot see the link. **ADDRESSED**: Track 4's prompt
  text requires the sentence around the pointer to locate the control in words,
  so the link is supplementary rather than load-bearing. This is the same
  two-sided requirement as
  `issues/features/2026-08-13-tell-the-agent-the-screen-is-unfocused.md`
  ("introduce the fact that supplemental information is there"), and the
  `channel` attribute fixed in Track 5 is the shared input both need. **GAP,
  narrow**: this plan does not verify how the TTS path renders a `control:`
  link's text, and narration goes through `speech-parsing.ts` /
  `<speech>` rather than the markdown renderer. Recorded in Open design
  questions.

## NOT in scope

- **Acting on the user's behalf.** No action that submits, sends, deletes,
  navigates, or changes a setting. `reveal` changes disclosure state and
  nothing else, enforced by the disclosure predicate rather than by
  instruction. Doing the thing is a different product with a different trust
  question, and the issue draws that line explicitly.
- **A spotlight tour.** Rejected in the issue with reasons. Multiple `control:`
  links in one message stay independent; clicking one points at one.
  memory-atlas's `parseAllLinks` behaviour is the thing we are deliberately not
  building.
- **Pointing into closed containers.** The agent cannot address a menu item
  inside a shut menu, because the scan cannot see it. It points at the trigger
  and says what is behind it. Making menu contents addressable would mean
  either opening menus to scan them or maintaining a static map of their
  contents; the first is intrusive, the second is the allowlist we rejected.
- **A general agent browser.** `issues/features/2026-06-12-agent-browser-scoped-to-box.md`
  wants the agent to load and verify its own rendered pages. Different problem:
  that one is about the agent's own output, this one is about the user's live
  screen. Neither closes the other.
- **Fixing discoverability.** `issues/features/2026-08-08-no-visible-search-or-home.md`
  (no visible search, no home surface) and
  `issues/bugs/2026-08-03-attach-vs-upload-menu-confusing.md` describe an
  interface that is hard to navigate. A pointer makes those failures
  survivable; it does not fix them, and it must not be used as an argument that
  they are fixed.
- **Android.** Track 5 keeps the transport Android-compatible and stops there.
- **A11y remediation.** The scan will make the app's a11y gaps legible — the
  unnamed `<main>`, the `title`-only send/mic cluster, missing `h1`s
  (`issues/code-quality/2026-05-28-color-contrast-wcag-aa-audit.md` is the
  adjacent open item). Improving them improves this feature, but a remediation
  sweep is its own work.

## Open design questions

- **Accname: hand-rolled or `dom-accessibility-api`?** Lean hand-rolled. The
  fallback chain this app actually exercises is short and known (101
  `aria-label`, 138 `title`, 6 `aria-labelledby`, plus text content), it avoids
  ~30 kB shipped into a mobile webview, and principle 6 says defence is sized
  to the boundary. The counter-argument is principle 8 and the bias toward
  strict: the library is spec-accurate and we would stop maintaining an
  approximation. Decidable cheaply — write the hand-rolled version with
  doctests over the app's real markup first, and swap if it misses.
- **Consent on `cb chat ui`.** RESOLVED (boxholder, 2026-08-23): none. There
  is no permission boundary between the agent and the UI — the agent not
  seeing the screen is a technical limitation being eased, not a privacy line.
  The chrome-only scan boundary (`data-cb-scan="exclude"`) still stands, as a
  content-hygiene rule rather than a consent substitute.
- **Does narration read a `control:` link, and how?** Narration runs through
  `<speech>` and `speech-parsing.ts`, not the markdown renderer, so a pointer
  written inside speech text may be spoken as raw URL text. Needs a look before
  Track 4's prompt guidance is written; the likely answer is that the agent
  keeps pointers out of `<speech>` and in the visible text, and the prose
  locates the control in words.
- **How far the `cb-` id convention should spread.** This plan annotates ~25
  chat-surface controls. Whether every routed page eventually gets the same
  treatment is a scope call, not a design one, and the answer probably depends
  on whether the boxholder finds himself asking "where is that" outside chat.
- **Whether `focus` and `reveal` have honest native meanings. RESOLVED BY
  IMPLEMENTATION (Track 5b).** Both do, in exactly two places on this surface,
  and nowhere else:
  - `focus` → **`cb-composer-input` only**: make the composer text field first
    responder, which raises the keyboard exactly as a tap on it would. No other
    native control has a first responder to make.
  - `reveal` → **`cb-composer-add` only**: present the actions sheet that button
    opens. It opens the sheet and stops there — it never picks a row for the
    user, which is the reveal/do line the rest of the plan draws.

  Every other (control, action) pair is **refused with a reason** the pointer
  shows in its broken-link tooltip — "`focus` is not supported for this control
  on this surface (`cb-composer-mic`)" — never silently no-oped. The mechanism
  is what makes that hold rather than being a rule to remember:
  `NativeControlEntry.actions` is *derived from* the handlers `.controlAnchor`
  was given, so a control cannot advertise an action nobody wrote code for, and
  the dump lists native controls with exactly the actions native will honour.

## Knowledge audits

Four agent-facing concepts land here: the `cb chat ui` command, the `control:`
link form, the `point`/`focus`/`reveal` vocabulary, and the reveal-versus-do
line. Per the default, each gets at least one entry in
`src/dev/knowledge-audits.yaml`:

1. `knows_directly` — given "the user asks where the microphone is", does the
   agent reach for `cb chat ui` rather than describing from memory? And the
   negative: told "I've moved your list", does it avoid volunteering a screen
   location it has not scanned for?
2. `knows_directly` — can the agent write a correct `control:` link with an
   `action` and a `description`, unprompted, given a dump?
3. `knows_directly` — asked to "just attach the file for me", does the agent
   correctly decline to operate the interface and instead reveal the menu?
4. `knows_directly` — does the agent state the path-versus-`control:` rule
   correctly when asked how to point at a card versus a button?

Audits land **run**, not merely written:
`pnpm knowledge-audit run --box <absolute path to a test box> --filter
points-at-ui`, with the status comment recorded in `knowledge-audits.yaml`
before the plan completes. (Pass an absolute box path — `--box test1` resolves
inside the monorepo.)

## Implementation order

1. **Track 5 first chunk — `channel` fixed.** Independent, smallest, and
   removes an active lie (iOS reported as `web-mobile`). Client → route →
   `contextAttrs` → prompt sentence → `<chat-app>` doctest.
2. **Track 1 — scan library.** `accessible-name.ts`,
   `scan.ts`, `resolve.ts`, all pure, all doctested against real markup
   fragments from the chat surface.
3. **Track 4a — the composer-row unification, then the ids and `data-cb-*`
   attributes** on the table's controls, ending with `bin/tour --all` to
   confirm axe finds no duplicate id. Depends on Track 1 fixing the names;
   unblocks realistic testing of everything after.
4. **Track 2 — `control:` links.** `classifyMarkdownHref` member,
   `ControlPointer`, the ring overlay, the three actions. Depends on 2 and 3.
   Hand-written links in a card exercise it end to end with no agent involved.
5. **Track 3 — the round trip.** Routes, client handler, `cb chat ui`, the dump
   formatter. Depends on 2.
6. **Track 4b — prompt text, skills pointer, knowledge audits (written and
   run).** Depends on 5.
7. **Track 5 remainder — native registry, two command kinds, merge, native
   ring, mobile-contract updates and fixtures.** Depends on 2-5 being stable so
   the native side implements a settled contract rather than a moving one.
   **IMPLEMENTED** in two commits: 7a (registry, V2 envelope, result channel,
   `scan-controls`, merge and coverage) and 7b (`point-at-control`, the native
   ring, `focus`/`reveal`, and native entries becoming real `control:` links in
   the dump). What 7b left unverified is the round trip in a *real* webview —
   both halves are exercised by doctests against an injected bridge and by
   XCTest against the registry, but no web-to-native message has yet crossed a
   live `WKWebView` on a paired box.

Chunks 1-6 are commit boundaries within one plan and **ship without waiting
for 7**. An earlier draft gated everything on the native half, to avoid the
"quietly lies on the phone" outcome — but the dump already refuses to lie:
on `channel="ios-native"` with no native answer it reports
`coverage: "dom-native-unavailable"` and names the controls it cannot see
(Track 5, "Merging"). That sentence is what makes a web-only build honest on
the phone, so it is built in chunk 5, not deferred to 7. The native half is
wanted and is done next, with the understanding (boxholder, 2026-08-23) that
it may work somewhat differently and at lower fidelity than the DOM scan — a
declared registry rather than a walk, and `focus`/`reveal` only where they have
honest native meanings.

## Rollout shape

**Test posture.** Named per codepath, as a design tool:

- `test/frontend/lib/ui-scan/accessible-name.doctest.md` — the fallback chain
  over the app's real shapes: `aria-label` + `title` together, `title`-only,
  text-content with an `aria-hidden` icon inside, `placeholder`-only, and the
  empty case that gets dropped.
- `test/frontend/lib/ui-scan/annotations.doctest.md` — every `data-cb-reveal`
  element also presents `aria-expanded`/`aria-haspopup`/`role="tab"`; every id
  in Track 4's table exists in the source exactly once; every `cb-` id is
  kebab-case. (Document-level id uniqueness is axe's job in the tours, not a
  doctest's — this checks the source, axe checks the rendered page.)
- `test/frontend/lib/ui-scan/scan.doctest.md` — visibility rules, off-screen
  included and marked, `aria-hidden` subtree excluded, an unannotated control
  listed with a null id, `actions` gaining `reveal` only from the attribute,
  the entry cap.
- `test/frontend/lib/view-url.doctest.md` (extend) — `control:` classification,
  params, unknown action degrades to `point`, empty id falls through.
- `test/webapp/routes/chat-ui-routes.doctest.md` — the four outcomes, the
  loopback guard 403, the Zod-reject path, and the native-unavailable coverage
  value.
- A tour assertion in `test/tours/nav-pages.tour.ts` that every `Dropdown`
  trigger on each routed page exposes `aria-haspopup` — this is what keeps the
  reveal predicate honest as the app changes.

**Done-when**, as checkable assertions: `cb chat ui` against a live chat
session returns a dump containing `cb-composer-mic`, `cb-composer-send` and
`cb-composer-add`, with `[reveal]` on `cb-composer-add`; a hand-written
`control:cb-composer-add?action=reveal` link opens the attach menu; the same link
with a nonexistent id renders as `BrokenLink`; the same dump run from the iOS
app includes the native composer entries and reports `coverage: dom+native`;
and the four knowledge audits pass.

Status 2026-08-23: every done-when except the iOS dump is verified live. The
native half is built and simulator-verified (registry, ring, focus/reveal,
refusals), but no `coverage: dom+native` dump has been produced through a real
paired WKWebView — local simulator pairing needs box credentials the session
correctly declined to mint. That last verification is a field probe with the
boxholder's phone, or a paired local session.

**Knowledge audits.** All four land with the plan, run, with status recorded.

**Migration.** None. No on-disk data shape changes. `channel` is read-only,
its new value is additive, and an old client that does not send it falls back
to today's user-agent classification.

**Cross-model review.** Done (Codex, gpt-5.5, plan mode). Eight findings; the
plan was revised on six of them. The load-bearing ones: the derived-id tier was
cut in favour of authored-only addresses; the `reveal` predicate stopped being
inferred from ARIA once `TabBar.tsx:34` and `InteractiveChat-controls.tsx:176`
showed `role="tab"` firing real state changes; the two-new-enum-members claim
about the iOS command became a V2 envelope plus a result channel, once
`NativeComposerContract.swift:88` (non-optional `selection`) and `:108-150` (an
ack that cannot carry data) were read; `BrokenLink` was found to be private and
render-time-static, so it moves to a shared module and `ControlPointer` becomes
stateful; `composer.stop` was mapping two unrelated controls to one shared id;
and a citation to `ChatWebView.swift:189` was simply wrong.

**Then the boxholder changed the address mechanism**: use the HTML `id`, not a
bespoke attribute, with `accessibilityIdentifier` as the iOS shim — and treat
mutually-exclusive component states sharing one id as the normal case, with the
state-varying name and description as the payoff. Verified and adopted: it
makes resolution `getElementById`, hands uniqueness enforcement to axe in the
tours (already running), and surfaced the mounted-but-hidden composer-row
duplication that a private attribute would have concealed. Re-review is
warranted if the iOS track's shape changes again.

**Cross-model review of the built web slice.** Done (Codex), after Tracks 1–4
landed. Five findings, four accepted and fixed in the same pass: the scan walked
user content as well as chrome (fixed with the `data-cb-scan="exclude"`
boundary above); `resolveControl` proved only that an id existed, so a pointer
could ring or `reveal` a CSS-hidden element (fixed with the shared visibility
predicate and the `hidden` failure); the `offscreen` flag ignores clipping
ancestors, and the ring's placement after `scrollIntoView` was checked — the
ring re-measures its target every frame while it is up (`ui/ControlRing.tsx`),
so a scroll settling under it is already handled, and the clipping limitation is
documented rather than fixed; and the mic's narration `data-cb-does` described
narration mode backwards ("the agent speaks its replies back", when the overlay
makes the agent quieter, not louder). Finding 4 — that the dump should spell out
the `control:` link form more explicitly — was declined: the dump's trailing
paragraph shows the full link form and the knowledge audits verify agents write
`action`/`description`.
