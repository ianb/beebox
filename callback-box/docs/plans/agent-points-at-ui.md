---
title: "The agent sees the interface and points at controls in it"
status: draft
workstream: points-at-ui
issues:
  - ../../../issues/features/2026-08-14-agent-can-see-and-point-at-the-interface.md
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
scan reads the DOM and the enrichment is a `data-` attribute** — both work on a
raw `<button>` with no component migration.

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
only** (`surface`, Track 5), not for the dump.

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
   * Author-declared address, from `data-control`. Null for a control that is
   * on screen but was never given one — such a control appears in the dump so
   * the agent knows it exists, but cannot be pointed at.
   */
  id: string | null;
  /** ARIA role, explicit or implicit from the tag. */
  role: string;
  /** Computed accessible name. Never empty — a nameless control is dropped. */
  name: string;
  /** Nearest named region/landmark, for grouping in the dump. */
  container: string | null;
  /** Author-written "what it does", from `data-control-does`. */
  does: string | null;
  /** Actions this control opts into, from `data-control-reveal`. */
  actions: ControlAction[];
  /** Present and false for a control that is visible but not operable. */
  disabled: boolean;
}
```

**The address: authored only. Seen ≠ addressable.** A control is addressable if
and only if it carries `data-control="composer.mic"` — a dotted, hand-chosen,
stable name **shared with the native shell**, so `control:composer.mic` means
the same control whether the user is on the web or in the iOS app. Roughly 25
controls get one (Track 4's table).

Everything else the scan sees is still **listed** in the dump, with its role,
name and container, and no address. The agent can say *"the pencil button at
the top right of the card panel"* — it just cannot hand out a tappable link for
it. This is the issue's requirement met exactly: everything visible by default,
annotation enriches, and an unannotated control degrades to its accessible
name. What it does not do is promise a link the app cannot reliably honour.

The alternative — deriving an address from role + name + container for
unannotated controls — was designed and cut. It fails on its most important
case. `InteractiveChat-voice-button.tsx:47` gives the mic a four-way `title`:
``title={voicePaused ? "Resume recording (stops speech)" : isTranscribing ? "Stop recording" : narrationEnabled ? "Voice input (narration mode)" : "Voice input"}``
— so a name-derived address for the mic churns between four values as the user
talks, and the mic is the single most asked-about control in a voice product. A
derived scheme therefore needs authored overrides anyway, plus collision
suffixes, plus a re-scan-and-match resolver, to be *less* reliable than the
attribute it was avoiding. Authored ids alone make resolution a single
`querySelector` and make every address that appears in a dump one the app has
committed to.

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

**What is scanned.** Interactive elements and landmarks only: elements matching
the focusable/widget-role set, plus `nav`/`main`/`header`/`footer`/`aside` and
anything with a landmark or `region` role. **Content headings and prose are
not scanned.** This keeps the dump about chrome, and it keeps the payload from
becoming an oblique copy of whatever card the user is reading — the agent
already learns that through `open-card`.

**Enrichment.** `data-control-does="opens the attach menu — capture, file,
upload, screenshot, share location"`. An attribute on the element, not a
registry keyed by id, for one reason: **a description that lives on the element
cannot be orphaned by a rename.** It moves with the control or it is deleted
with it. There is nothing for a `doc-check`-style guard to check, because there
is no reference that can dangle. (Content staleness remains, in the same class
as a stale code comment; the answer there is review, not tooling.)

Enrichment is scoped, not open-ended: **annotate disclosure controls first.**
The scan can only see what is currently on screen, so the contents of a closed
menu are invisible to it by construction. `data-control-does` on the trigger is
how "capture, file, upload, screenshot, share location" reaches the agent at
all. Everything else degrades to its accessible name, per the issue.

**The reveal/do boundary: opt-in, not inferred.** `reveal` is the only action
that dispatches a synthetic click, so it is the only place the "reveal it,
don't do it for them" line can be crossed. It requires an explicit opt-in:

```tsx
data-control="composer.add" data-control-reveal
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
control carrying `data-control-reveal` must also present `aria-expanded`,
`aria-haspopup` or `role="tab"`, asserted by a doctest over the annotated set.
That catches an author who tags a control that has no disclosure semantics at
all, and it keeps the a11y layer and this feature reinforcing each other as the
issue argues — it just no longer stands alone.

**Resolution** is `document.querySelector('[data-control="<id>"]')` against the
live DOM. Zero matches, or more than one, is a failure — never "pick the first"
— and a duplicate `data-control` in one document is a bug the scan reports in
its header. Fails closed, like `resolveRefPath` (`src/shared/ref-path.ts`).

**Vocabulary lock-ins.** `data-control`, `data-control-does`,
`data-control-reveal`, the dotted id form, the action names `point` / `focus` /
`reveal`, and the `control:` scheme. All of these cross into iOS and, later,
Android; renaming any of them afterwards is a bridge-contract migration.

**First implementation chunk.** `src/frontend/src/lib/ui-scan/scan.ts` +
`accessible-name.ts` with pure-function doctests, and the three `data-control*`
attributes on the ~25 chat-surface controls listed in Track 4's inventory. No
route, no CLI, no link rendering yet.

### Track 2 — The pointer: `control:` links

**What.** `control:` becomes a recognised markdown href kind that renders as an
icon-marked inline reference and, on click, acts on the live interface.

**Why this needs to change.** The agent has no way to indicate an element. The
seam for one exists and currently sends `control:` down the `external` branch
(`view-url.ts:161` — any `[a-z][\w+.-]*:` prefix is external), so today it
would render as a dead `<a href="control:…">`.

**Direction.**

```markdown
[the mic](control:composer.mic?action=point&description=Tap%20and%20talk)
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
| `reveal` | `point`, then click **iff** the target carries `data-control-reveal` | disclosure only |

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
  cheap trigger — a `MutationObserver` scoped to `[data-control]` attribute and
  childList changes, debounced — so a pointer that has gone dead *looks* dead
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
  authed. JSON: `{ack:true}` | `{entries, coverage, surface, url}` |
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
  button [Place: test1](control:nav.place)
  button [Session: Dinner plans](control:nav.session) [reveal]
    — the thread menu: new session, recent chats, model, delete this chat
  button [Voice input (narration mode)](control:nav.voice) [reveal]
    — mute and narration toggles, and voice settings
  button "Open debug log (2 errors)"                    (no address)
region "Compose message"
  button [Add](control:composer.add) [reveal]
    — the attach menu: capture, attach file, upload files, screenshot,
      share location
  textbox [Type a message...](control:composer.input)
  button [Send](control:composer.send)
  button [Voice input](control:composer.mic)
    — hold to dictate; tap to start continuous dictation
tablist "Open files"
  tab "Dinner_Plans.doc.card"                           (no address)

To point the user at one of these, write its link into your reply:
[the mic](control:composer.mic?action=point&description=tap%20and%20talk).
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
The one thing it does need is Track 5's `surface` attribute, because "where is
the mic" has different answers on web and in the iOS app.

**Vocabulary lock-ins.** The route paths, the fulfillment JSON shape, and the
dump's line format.

**First implementation chunk.** The route pair with its Zod schemas and route
doctests, the client-side request handler, and the CLI command.

### Track 4 — Annotation pass, prompt convention, and audits

**What.** Put `data-control`, `data-control-does` and `data-control-reveal` on
the controls that matter, document the convention where the agent reads
conventions, and verify it absorbed it.

**Why this needs to change.** An unannotated app still produces a dump, but the
disclosure controls — the ones whose contents the agent cannot see — carry no
description, which is the half that answers "how do I do X".

**Direction.**

Authored ids, chosen so web and native agree (Track 5 uses the same strings):

| id | web | native (iOS) |
|---|---|---|
| `nav.place` | `PlacePill.tsx:195` | — |
| `nav.session` | `SessionChip.tsx:206` | — |
| `nav.voice` | `VoiceChip.tsx:228` | — |
| `nav.profile` | `AppNav.tsx:44-58` | — |
| `nav.todo` / `nav.errors` | `AppNav.tsx:168,187` | — |
| `composer.add` | `InteractiveChat-composer.tsx:208` | `ComposerActionsView` trigger |
| `composer.input` | `InteractiveChat-composer.tsx:60` | `ComposerTextView.swift:30` |
| `composer.send` | `InteractiveChat-composer.tsx:121` | `NativeComposerView.swift:361` |
| `composer.mic` | `InteractiveChat-voice-button.tsx:28` | `NativeComposerView.swift:386` |
| `composer.capture` | `InteractiveChat-composer.tsx:238` | `NativeCaptureView` entry |
| `composer.stop-dictation` | — (web has no separate control) | `NativeComposerView.swift:354` "Stop continuous dictation" |
| `chat.stop-agent` | `TargetStrip.tsx:53` "Stop agent" | — |
| `chat.stop-speech` | `TargetStrip.tsx:43` "Stop speaking" | — |
| `panel.tabs` / `panel.close` | `InteractiveChat-controls.tsx:163,209` | — |

An id means the same control on both platforms or it is not shared. An earlier
draft mapped one `composer.stop` onto web `TargetStrip.tsx:53` (*"Stop agent"*,
shown while streaming) and native `NativeComposerView.swift:354` (*"Stop
continuous dictation"*) — two unrelated controls under one name, which would
have shipped the shared-id contract already broken. They are separate ids
above, and a `—` in a column is the honest answer: the platform has no
counterpart, so the agent gets `no such control on this surface` rather than a
pointer at the wrong thing.

`data-control-does` goes on every `[reveal]` control in that table plus the
mic, whose behaviour (tap versus hold, and the spoken keywords) is not
inferable from a label. `data-control-reveal` goes on `nav.session`,
`nav.voice`, `nav.profile` and `composer.add` — the four menu triggers — and
nothing else in this pass.

Prompt text lands in `src/core/chat/session/prompts.ts`, in the existing
"Showing things in chat" section, directly after the card-path link paragraph —
so the two kinds of pointing are read as one vocabulary with one rule:

> **A path points at content. `control:` points at the interface.** If the
> thing has a place in the box, link its path. If it exists only on screen — a
> button, a menu, a field — run `cb chat ui` and link its `control:` address.
> You may `point` at a control, `focus` it, or `reveal` what it opens. You
> never operate it for the user: revealing the attach menu is helping; attaching
> the file is doing it for them, and is not yours to do.

A pointer to `cb chat ui` also goes in `src/core/box/skills-content.ts`,
alongside the existing `cb chat screenshot` sentence
(`skills-content.ts:455`), phrased the same way: reach for it when interface
location is genuinely the question, not by reflex.

**Vocabulary lock-ins.** Every authored id in the table above.

**First implementation chunk.** The `data-control` attributes and the prompt
section. The audits follow once Tracks 1-3 are runnable.

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
.controlAnchor("composer.mic", does: "hold to dictate; tap for continuous dictation")
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
no DOM match for `composer.mic`, sees the bridge is present, and sends
`point-at-control`. Native draws the ring, or rejects with a reason, and the
rejection turns the pointer into a `BrokenLink` carrying that reason. `focus`
and `reveal` map onto native focus and sheet presentation where they exist and
are rejected with a reason where they do not; the web side must not assume
symmetry.

**Surface reporting.** A new `<chat-app>` attribute `surface="web-desktop" |
"web-mobile" | "ios-native"`. Today `channel` is classified server-side from
the user-agent (`chat-send-routes.ts:240` → `chat-helpers.ts` `classifyChannel`),
which reports the iOS webview as `web-mobile` and hides the one distinction
that changes the answer. The client must send it instead — only the client
knows whether the native shell is in effect (`ChatPage.tsx:126-130`).

It is one attribute in the dump and five touchpoints in the code, which the
plan should say out loud rather than call cheap: the send-body Zod schema and
`extractCardFields`-style filter in `chat-helpers.ts`; a `surface` field on
`ChatSendInput` (`src/core/chat/session/messages.ts`); latest-wins merging in
`combineQueuedInputs` (`src/core/chat/session/state.ts`) alongside `channel`;
`contextAttrs` **and** `READ_ONLY_ATTRS` in `src/core/chat/features.ts` (a
context attribute the agent must not be able to set via a delta); and the
client-side send plumbing through `api-chat.ts` and the chat machine. That is
the same path `openCard` already walks, so it is well-trodden, not novel.

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
`coverage` union, the `surface` attribute values, and every shared authored id
from Track 4's table.

**First implementation chunk.** The `surface` attribute end to end (client →
route → `<chat-app>` → prompt), which is independently useful and is the
smallest piece that removes the "iOS looks like mobile web" lie.

## Could this be simpler?

**The simplest version that could plausibly work.** A hand-written TypeScript
constant listing ~20 controls with an id, a label, a CSS selector and a
description. `cb chat ui` prints it, filtered by which selectors currently
match a visible element. `control:<id>` resolves by
`document.querySelector(entry.selector)`. No accname computation, no `data-`
attributes, no role walk, no dump of anything the list does not name. Perhaps
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
| Two elements carry the same `data-control` (a component rendered twice, e.g. the desktop and mobile composer rows both mounted) | Yes — resolver doctest, multi-match case; plus a scan doctest asserting the dump reports duplicates | Yes — more than one match is a failure, never "pick the first"; the scan header names the duplicated id | Clear |
| Native bridge does not answer `scan-controls` in time | Yes — route doctest with a fake bridge that never answers | Yes — `coverage: "dom-native-unavailable"` and an explicit sentence in the dump | Clear |
| No client attached when the agent runs `cb chat ui` (phone locked, tab closed) | Yes — route doctest via the existing ack-window path | Yes — `no-client`, distinct from `timeout`, inherited from `pending-browser-request.ts:11-18` | Clear |
| Accname computation returns empty for a control that is genuinely important | Partly — doctests cover the fallback chain, not "was this one important" | Dropped from the dump, but the drop **count** is printed in the header | Clear (count), silent (which) — accepted; see below |
| An author puts `data-control-reveal` on a control that does more than disclose | Yes — a doctest asserting every `data-control-reveal` element also presents `aria-expanded`/`aria-haspopup`/`role="tab"` | Partial — the doctest catches the missing-semantics case, not a genuinely mislabelled disclosure control | Silent — accepted, and it is why the attribute is opt-in and confined to four menu triggers in this pass |
| A `Dropdown` caller forgets to spread `ariaProps`, so its trigger has no `aria-expanded` | Yes — a tour assertion that every `Dropdown` trigger exposes `aria-haspopup` | Yes — the `data-control-reveal` doctest fails, so the annotation cannot land | Clear |
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
  `surface` attribute added in Track 5 is the shared input both need. **GAP,
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
- **Consent on `cb chat ui`.** This plan proposes none, on the reasoning in
  Track 3. It is a privacy judgment about a channel the boxholder built a
  consent popup for in the adjacent case, so it should be his call, not the
  plan's.
- **Does narration read a `control:` link, and how?** Narration runs through
  `<speech>` and `speech-parsing.ts`, not the markdown renderer, so a pointer
  written inside speech text may be spoken as raw URL text. Needs a look before
  Track 4's prompt guidance is written; the likely answer is that the agent
  keeps pointers out of `<speech>` and in the visible text, and the prose
  locates the control in words.
- **Duplicate `data-control` on a responsive pair.** `DesktopComposerRow` and
  `InteractiveChat-mobile-row.tsx` render the same four controls, and if both
  are mounted with only one visible, the id is duplicated in the DOM. The scan's
  visibility filter should make only one of them a candidate, but that is a
  claim to verify in Track 1 rather than assume — if both can be mounted at
  once, the ids need a variant suffix or the rows need to share one element.
- **Whether `focus` and `reveal` have honest native meanings.** `focus` maps to
  first-responder; `reveal` maps to presenting the sheet a control opens. Both
  are plausible and neither is verified. The plan requires them to be rejected
  with a reason rather than silently no-oped where they do not apply, which
  bounds the risk of getting this wrong.

## Knowledge audits

Four agent-facing concepts land here: the `cb chat ui` command, the `control:`
link form, the `point`/`focus`/`reveal` vocabulary, and the reveal-versus-do
line. Per the default, each gets at least one entry in
`src/dev/knowledge-audits.yaml`:

1. `knows_directly` — given "the user asks where the microphone is", does the
   agent reach for `cb chat ui` rather than describing from memory?
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

1. **Track 5 first chunk — `surface` attribute.** Independent, smallest, and
   removes an active lie (iOS reported as `web-mobile`). Client → route →
   `contextAttrs` → prompt sentence → `<chat-app>` doctest.
2. **Track 1 — scan library.** `accessible-name.ts`, `control-id.ts`,
   `scan.ts`, `resolve.ts`, all pure, all doctested against real markup
   fragments from the chat surface.
3. **Track 4a — `data-control` / `data-control-does` attributes** on the table's
   controls. Depends on Track 1 fixing the attribute names; unblocks realistic
   testing of everything after.
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

Chunks 1-6 are commit boundaries within one plan. Nothing ships until 7
completes; a merged web-only version would be the "quietly lies on the phone"
outcome the issue warns about.

## Rollout shape

**Test posture.** Named per codepath, as a design tool:

- `test/frontend/lib/ui-scan/accessible-name.doctest.md` — the fallback chain
  over the app's real shapes: `aria-label` + `title` together, `title`-only,
  text-content with an `aria-hidden` icon inside, `placeholder`-only, and the
  empty case that gets dropped.
- `test/frontend/lib/ui-scan/annotations.doctest.md` — every `data-control` in
  the app is unique among simultaneously-visible elements; every
  `data-control-reveal` element also presents `aria-expanded`/`aria-haspopup`/
  `role="tab"`; every id in Track 4's table exists in the source.
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
session returns a dump containing `composer.mic`, `composer.send` and
`composer.add`, with `[reveal]` on `composer.add`; a hand-written
`control:composer.add?action=reveal` link opens the attach menu; the same link
with a nonexistent id renders as `BrokenLink`; the same dump run from the iOS
app includes the native composer entries and reports `coverage: dom+native`;
and the four knowledge audits pass.

**Knowledge audits.** All four land with the plan, run, with status recorded.

**Migration.** None. No on-disk data shape changes. The `<chat-app>` `surface`
attribute is additive and read-only, and old clients that do not send it simply
omit it, which the snapshot composer already handles by dropping absent
attributes.

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
and a citation to `ChatWebView.swift:189` was simply wrong. Re-review is
warranted if the iOS track's shape changes again.
