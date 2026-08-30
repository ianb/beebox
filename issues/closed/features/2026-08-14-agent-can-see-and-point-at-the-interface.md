---
title: "Let the agent see the interface and point at things in it"
workstream: points-at-ui
area: beebox
design: ../../../beebox/docs/plans/agent-points-at-ui.md
labels: [chat, ui-sensibility]
priority: important
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder idea, with memory-atlas prior art
resolution: implemented
---

Implemented across the `points-at-ui` workstream (ui-scan library, `bbx-`
ids/annotations on the chat surface, `ControlPointer` + ring, `bbx chat ui`
routes/CLI/dump, prompt text, five passing knowledge audits, and the iOS V2
bridge envelope with native registry + point/focus/reveal). See the plan's
Status note (`beebox/docs/plans/agent-points-at-ui.md`, "Status
2026-08-23") for the one remaining gap: a `coverage: dom+native` dump has not
been produced through a real paired WKWebView — that needs the boxholder's
phone, so the plan itself stays `status: partial` pending that field check.

When the boxholder asks *"where is that"* or *"how do I do X"* — usually by
voice, phone in hand, not scanning the screen — I want the agent to look at what
is actually on screen and **point at the control**, so I can tap the thing
rather than parse a paragraph describing where it is.

Today the agent is blind to the interface. It can describe features from its
prompt, but it cannot see what is rendered, cannot know whether the button it is
describing is even visible, and has no way to indicate a specific element. The
answer to "where is that" is prose, and prose about UI location is exactly the
kind of answer that is worst to receive by ear.

## Why this is important (2026-08-23)

Marked important by the boxholder. The evidence that moved it is that the agent's
blindness is not only a missing capability — it actively produces wrong answers,
and a journey walkthrough caught one.

A first-time user was told by the assistant: *"I've set up an Inventory area
(it's in your sidebar now)"*. There is no sidebar on the page they were looking
at. They wrote: *"either it's describing a different app or the word is wrong."*
The phrase traces to an example in the agent guide
([the sidebar issue](../../bugs/2026-08-23-agent-guide-example-puts-landmarks-in-a-sidebar.md)),
which is fixable on its own — but the reason a stale example can mislead at all
is the premise of this issue: **the agent's only account of the interface is a
static document, and it has no way to check it against the screen.**

That reframes the value. This was filed as "let the agent help me find things",
which reads as a convenience. The walkthrough shows the current state is worse
than an absence: the agent describes the interface *confidently* from a source
that cannot go stale loudly, so every drift between the UI and the guide becomes
a wrong direction delivered with authority, to a person who has no way to tell.

Two further observations from that walk, both bearing on the design questions
below:

- Everything the person came to understand about the app arrived inside a
  sentence the assistant wrote — what it was for, where their list lived, what a
  landmark is. The assistant is already the primary navigation surface whether or
  not it can see anything, which raises the cost of it being wrong.
- Their single largest complaint was not being able to say where their own list
  was, after having built it. That is this feature's use case arriving unprompted
  in a journey that was not about navigation at all.

## Shape

Roughly three `bbx`-side capabilities, deliberately small:

1. **View** — dump the interface: what controls are present and what each one
   does. **The accessibility tree is the base**, and it should carry most of the
   weight — we have real a11y coverage and it is already the machine-readable
   description of what is on screen. But the agent wants **more than a11y gives
   it**: a11y says what a control *is* and how it is labelled, and the agent
   needs what it *does*. An accessible name says "Attach"; the useful line is
   "opens the attach menu — camera, file, or a card from this box." So: a11y
   tree plus an extended-metadata layer over it, not a hand-built parallel list.
2. **Point** — refer to a specific element so the user can find it.
3. **A few limited actions** — open, focus, open a menu. Not driving the UI;
   just getting the user to the thing. The line is roughly "reveal it" versus
   "do it for them."

Basing the dump on a11y rather than an annotation allowlist is a deliberate
divergence from memory-atlas (below): everything is visible to the agent by
default, annotations only *enrich*, and an unannotated control degrades to its
accessible name instead of disappearing. It also means the a11y work and this
feature reinforce each other rather than competing for the same effort.

## Prior art: memory-atlas built most of this

memory-atlas (`~/src/memory-atlas`, the same codebase our
`src/frontend/src/lib/parseTags.ts` was adapted from) has a working version, and
it is worth copying the parts that work and knowing which parts it left out.

**The dump is an opt-in annotation allowlist, not a tree walk.**
`lib/help/getdomllmhelp.ts:4-32` queries `[data-llm-action]`, filters to visible
elements, and emits `{elementId, visibleAs, actionDescription}` per control.
Developers annotate deliberately — e.g. `components/authmenu.tsx:14-15`,
`data-llm-action="Opens a menu for account actions: sign out, and billing"`;
reusable components take `dataLlmAlt`/`dataLlmAction` props
(`components/tabs.tsx:92-93`). So the "extended metadata" is not derived from the
a11y tree — it *replaces* it, and the a11y tree is not consulted at all.

That is a real design position: hand-authored, so it says what the control means
rather than what it is labelled, and it stays small because only annotated
things appear. The cost is that it can go stale silently and anything unmarked is
invisible to the agent.

**The dump reaches the model two ways.** A `viewUi` tool
(`lib/chat/tools.ts:181-201`) the model calls on demand, advertised only when
there is something to see (`lib/chat/prompting.ts:237-239`) — plus the client
attaching a fresh snapshot to *every* outgoing message
(`components/homecontroller.ts:149-157`). The tool result is `hideFromUi: true`
and old copies collapse to `"[help omitted]"`, which is the right instinct: this
is bulky context that must not accumulate across a conversation.

**Pointing is markdown the model writes, not a function it calls.**
`lib/help/domhelprepresentation.ts:1-19` presents each control as
`Button [name](#help=elementId) performs the action: …` and then tells the model
the output convention:

> When referring to a button use the format:
> `[button name](#help=buttonId&instructions=instructions for the button)` —
> When clicked this will highlight the button on the screen and show the
> instructions.

So the pointer is an ordinary link in the agent's prose, carrying both the target
and agent-authored instructions for that target.

**The bubble is user-triggered.** `components/markdownwithtour.tsx:1-95`
intercepts clicks on `#help=` links, parses every such link in the message block
into a multi-step tour, and hands them to `@reactour/tour`, which draws a
spotlight mask and a popover anchored to the element. Nothing appears until the
user clicks. There is an unused `highlightElementsWithOverlay` primitive at
`lib/highlightelement.ts:1-55` — no callers — which looks like an earlier,
agent-fires-it-directly approach that lost.

**What memory-atlas does not have**: any open/focus/menu action tool (only
`switchActivity`, a navigate), an agent-initiated highlight, or custom rendering
for the reference beyond a plain link. Its tag system (`lib/parsetags.ts`)
carries `speech`/`reasoning`/`addendum` and similar — nothing UI-related. So
capability 3 above has no precedent there and is genuinely new design.

## The pointer: a link with a custom scheme, not a tour

The spotlight-tour half of memory-atlas is the part **not** to copy. Boxholder's
preferred shape is a link in the markdown, rendered with a **custom icon beside
it**, which on click focuses the target and can show a bit of text:

```markdown
[look at this](control:control-id?action=focus&description=See%20it%20open)
```

- `control:` — a custom scheme, taking the control id as its body.
- `action` — optional, defaulting to `point`. `focus` and the other limited
  actions from capability 3 are the other values.
- `description` (or `help`) — text shown beside the link. Agent-authored, so it
  can say why this control, in this answer, rather than repeating the generic
  metadata.

This keeps the reference *in* the sentence that motivates it, which is the point:
a pointer is mostly useful contextualized. The icon marks it as different from an
ordinary link so the reader knows it acts on the interface rather than navigating
away.

**We have the seam for it.** `classifyMarkdownHref` (used by `makeLink`,
`src/frontend/src/components/Markdown.tsx:92-141`) already classifies hrefs into
kinds — relative box path, external, and the retired `view:` legacy marker — and
renders each differently, including a `BrokenLink` for a target that does not
resolve. A `control:` kind slots directly into that switch, and the
does-not-resolve case already has an established treatment: render visibly broken
rather than silently inert. That matters here, since a control that has scrolled
away or unmounted is the normal failure.

**Why not a fragment.** The obvious first move is `[look here](#control-id)` —
no new scheme, and fragments already mean "somewhere on this page." Rejected for
three reasons, in increasing order of weight:

1. **No room for `action` or `description`.** A fragment is a bare name. The
   only way to attach parameters is a query string glued onto the fragment —
   `#control-id?action=focus&…` — which is precisely the shape memory-atlas
   landed on (`#help=elementId&instructions=…`) and it reads as perverse: a
   query string belongs before the fragment, not inside it.
2. **It is not a link.** A fragment link navigates — it moves you to a place in
   the document. This does not navigate in any sense. The target is a control on
   the screen you are already looking at, and clicking it makes the interface
   *do* something. Borrowing the syntax of navigation for something that is not
   navigation is the actual mistake; the surface similarity is what makes it
   tempting.
3. **Fragments are already spoken for.** They mean something in a URL, and a
   card path can carry one. A control reference that looks like an in-document
   anchor invites exactly the confusion the scheme prevents.

`control:` says what it is at the front of the string, leaves the query string in
its normal position doing its normal job, and cannot be mistaken for navigation.

**One honest tension**: we just retired the `view:` scheme, and reintroducing a
custom scheme days later deserves an argument. The argument is that they differ
in kind — `view:` duplicated an address space that already existed (a card has a
path; `view:` was a second way to say the same thing), whereas a control has no
address in the box at all. There is nothing for `control:` to duplicate. Worth
stating in the design so the next reader does not read it as backsliding.

## What we already have

- **A11y snapshots exist, but dev-side only.** `bin/browse snapshot [-i]`
  returns a role/name tree with `ref=eN` handles, and
  `test/tours/tour-lib/browse.ts:75-79,130-143` parses refs out of it and clicks
  them. That is a developer instrument run against the dev router; the deployed
  box agent has no browser at all. Closing that gap is already filed as
  [agent-browser scoped to a box](../../features/2026-06-12-agent-browser-scoped-to-box.md) —
  the "look at" half of this issue, from the self-verification angle.
- **A channel for per-turn situational context.** `composeTurnContent`
  (`src/core/chat/session/start.ts:139-160`) already prepends a `<chat-app …/>`
  tag to every user turn. That is the natural place for a UI snapshot to ride,
  and it is the same seam
  [screen-unfocused](../../features/2026-08-13-tell-the-agent-the-screen-is-unfocused.md) wants.
  Both want the client to tell the agent about the viewing situation.
- **A tag vocabulary and a parser.** `parseTags.ts` is generic — a new tag needs
  only to be listed by its caller. The hand-rolled layer in
  `src/frontend/src/components/chat/message-parsing.ts:41-56,113-132,211-225`
  handles `<attachments>`, `<schedule>`, `<task-notification>` and friends and
  strips control tags from rendered markdown. Not the mechanism for the pointer
  itself (that is a link, above), but the place a *snapshot request* or any
  out-of-band control traffic would live if the design needs one.
- **The reverse direction already ships.** The user can select content in the
  companion pane and attach it to a message, which serializes as a
  `[selectionN]` token (`InteractiveChat-selections.ts`,
  `src/frontend/src/lib/selection/`). Agent→UI pointing is the mirror of a token
  scheme we already run.

## The tension worth settling first

`docs/plans/interface-as-cards.md:419-450` takes an explicit position:

> the agent doesn't draw UI; it points at cards — a callout is a card ref + view
> hint … and the shell chooses embodiment per modality

That is pointing at *content*, with the shell deciding how to embody it per
surface. This issue is pointing at *chrome* — a button, a menu, a control. They
are not the same mechanism and probably should not become one, but they should
share a vocabulary rather than the app growing two unrelated ways for an agent to
say "that one over there." Worth deciding before either is built.

## Design questions

- **What is a control id, and is it stable?** `control:` needs a name the agent
  can write into prose and the client can still resolve on click. The tours'
  a11y refs (`ref=eN`) are per-snapshot handles and useless for this. A DOM `id`
  works only where one exists and is unique. This is the first thing to settle,
  because everything else hangs off it — and it decides how much annotation the
  feature needs even in the a11y-first design.
- **Where the extended metadata lives.** A11y gives the base; the "what it does"
  layer has to come from somewhere — a prop on the component, a registry keyed by
  control id, or a doc the dump joins against. Whichever it is, ask whether a
  control can be checked for having one, the way `doc-check` guards links, since
  a description that quietly goes stale is worse than none.
- **Snapshot per turn, tool on demand, or both?** memory-atlas does both. Per
  turn is reliable but pays context on every message; on demand is cheap but the
  agent has to know to look. The `hideFromUi` / collapse-old-copies treatment is
  worth keeping either way.
- **iOS.** The app is a `WKWebView` plus native chrome (composer, mic, capture).
  A DOM scan sees the web half and misses the native half entirely, which is
  exactly the half a voice user is most likely to ask about. Either the native
  side contributes its own entries or the feature quietly lies on the surface
  where it matters most. See `docs/mobile-contract.md`.
- **What counts as an action.** "Open the attach menu" is helpful; "attach this
  file" is the agent operating the app on the user's behalf, which is a different
  product and a different trust question. Draw the line explicitly.
- **Voice.** A tappable link is useless to someone not looking. When narration is
  on, the agent needs to be able to *say* where a thing is and still leave the
  tappable reference in the transcript — the same two-sided problem as
  [screen-unfocused](../../features/2026-08-13-tell-the-agent-the-screen-is-unfocused.md).
- **Staleness.** The snapshot describes the screen at send time. A long turn, or
  a user who navigates mid-answer, leaves the agent pointing at something gone.
  The pointer should fail visibly rather than highlight the wrong element —
  `BrokenLink` is the existing precedent for exactly this.
- **What `point` does, visually.** `focus` has an obvious meaning. The default
  `point` does not: a flash, a ring that persists, a scroll-into-view, or all
  three. Whatever it is should not require a modal layer — the reason for
  rejecting the tour was that it takes over the screen.
