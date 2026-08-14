---
title: "Let the agent see the interface and point at things in it"
workstream: unattached
area: callback-box
needs: [design]
labels: [chat, ui-sensibility]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder idea, with memory-atlas prior art
---

When the boxholder asks *"where is that"* or *"how do I do X"* — usually by
voice, phone in hand, not scanning the screen — I want the agent to look at what
is actually on screen and **point at the control**, so I can tap the thing
rather than parse a paragraph describing where it is.

Today the agent is blind to the interface. It can describe features from its
prompt, but it cannot see what is rendered, cannot know whether the button it is
describing is even visible, and has no way to indicate a specific element. The
answer to "where is that" is prose, and prose about UI location is exactly the
kind of answer that is worst to receive by ear.

## Shape

Roughly three `cb`-side capabilities, deliberately small:

1. **View** — dump the interface: what controls are present and what each one
   does. The accessibility tree is the base, but the interesting part is the
   **extended metadata**: a description of what a control *does*, authored for a
   reader who cannot see it. An accessible name says "Attach"; the agent needs
   "opens the attach menu — camera, file, or a card from this box."
2. **Point** — refer to a specific element so the user can find it.
3. **A few limited actions** — open, focus, open a menu. Not driving the UI;
   just getting the user to the thing. The line is roughly "reveal it" versus
   "do it for them."

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

That last point matches the boxholder's instinct: **things you tap are the right
affordance**, not a bubble the agent pops unbidden. An anchored bubble on click
gets both — the reference is contextualized in the sentence where it makes
sense, and the spotlight only interrupts when asked for.

**What memory-atlas does not have**: any open/focus/menu action tool (only
`switchActivity`, a navigate), an agent-initiated highlight, or custom rendering
for the reference beyond a plain link. Its tag system (`lib/parsetags.ts`)
carries `speech`/`reasoning`/`addendum` and similar — nothing UI-related. So
capability 3 above has no precedent there and is genuinely new design.

## What we already have

- **A11y snapshots exist, but dev-side only.** `bin/browse snapshot [-i]`
  returns a role/name tree with `ref=eN` handles, and
  `test/tours/tour-lib/browse.ts:75-79,130-143` parses refs out of it and clicks
  them. That is a developer instrument run against the dev router; the deployed
  box agent has no browser at all. Closing that gap is already filed as
  [agent-browser scoped to a box](2026-06-12-agent-browser-scoped-to-box.md) —
  the "look at" half of this issue, from the self-verification angle.
- **A channel for per-turn situational context.** `composeTurnContent`
  (`src/core/chat/session/start.ts:139-160`) already prepends a `<chat-app …/>`
  tag to every user turn. That is the natural place for a UI snapshot to ride,
  and it is the same seam
  [screen-unfocused](2026-08-13-tell-the-agent-the-screen-is-unfocused.md) wants.
  Both want the client to tell the agent about the viewing situation.
- **A tag vocabulary and a parser.** `parseTags.ts` is generic — a new tag needs
  only to be listed by its caller. The hand-rolled layer in
  `src/frontend/src/components/chat/message-parsing.ts:41-56,113-132,211-225`
  handles `<attachments>`, `<schedule>`, `<task-notification>` and friends and
  strips control tags from rendered markdown. A UI pointer could be a tag there,
  or a link convention as in memory-atlas — deciding which is part of the design.
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

- **Who authors the metadata, and does it drift?** Annotating components by hand
  is what makes the descriptions good and what makes them go stale. Is there a
  check that a control with an action has a description, the way `doc-check`
  guards links?
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
  [screen-unfocused](2026-08-13-tell-the-agent-the-screen-is-unfocused.md).
- **Staleness.** The snapshot describes the screen at send time. A long turn, or
  a user who navigates mid-answer, leaves the agent pointing at something gone.
  The pointer should fail visibly rather than spotlight the wrong element.
