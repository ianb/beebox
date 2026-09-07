---
title: "The chat input should be everywhere — send to the box from any page, not just chat pages"
workstream: chat-everywhere
area: beebox
needs: [manual-testing]
labels: [chat, ui, navigation]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "the chat input should be everywhere and we should make it work everywhere"
priority: normal
---

Today the composer exists only on chat pages. The boxholder wants the chat
input available on **every** page — browsing a card, the landmarks page, the
dashboard — and working: send from wherever you are.

Planning is in [Chat everywhere](../../beebox/docs/plans/chat-everywhere.md)
(2026-09-07). The boxholder clarified that selecting a landmark explicitly
switches conversational focus, while following cards across landmarks does
not. Dedicated and split are the same desktop conversation experience with
different space available; mobile needs one foreground surface and voice.
Seven walkthroughs establish the movement/multitasking acceptance cases and
will be replayed against the actual interface after implementation. The
mockups were accepted as roughly useful behavior sketches, not a visual redesign.

This is a real design item, not a widget move:

- **Where the message goes.** From a card page, presumably the chat bound to
  the current landmark (the `landmarks.forDir` / `latestForDirectory`
  resolution the place menu already uses) — which makes the composer also a
  *context signal*: "I'm looking at this card" could ride along (the
  `<chat-app>` envelope already carries context).
- **What surfaces where.** The full composer (voice, attachments, HQ toggle)
  vs a slim send-bar that expands; mobile vs desktop; the modal-not-split-pane
  direction (`2026-07-23-mobile-modal-not-split-pane.md`) leans mobile toward
  voice+callouts already.
- **Where replies land.** Send-and-stay (a callout/toast with the reply?
  navigate on tap?) vs jump-to-chat; the back-to-chat chip exists for the
  return path.
- **Drafts** are already box-scoped (`useDictationDraft` and the emission
  store; verified during planning). Their live services remain owned by
  ChatPage; an everywhere-composer must preserve them across page movement.
- **iOS parity** from day one (`bbx-ios-overlap`): the native composer is a
  separate implementation; "everywhere" on web widens a gap unless planned
  together — the input-plane-parity issue (`2026-07-19`) is the sibling.

The 2026-09-07 implementation checkpoint supplies the persistent web composer,
explicit conversation selection, frozen send binding and recovery, ambient
results, mobile foreground switching, and native V3 binding/pending parity.
Deterministic web/native checks, simulator XCTest, knowledge audits, and local
browser sends pass. The issue remains open for physical iPhone dictation through
navigation, keyboard/safe-area behavior, interruptions and screen-away return.
Product reconfirmation also remains for ambiguous generic Conversation labels
and for scheduled completions in previously visited sessions raising notices
beyond the narrower sent-to/left-running set.

## Manual testing

- [ ] On a physical iPhone, dictate while navigating between cards and confirm the live draft, source selections, and bound recipient survive.
- [ ] Exercise keyboard and safe-area behavior with the card and transcript foreground controls.
- [ ] Interrupt and background the app during recording/delivery, then confirm recovery and screen-away results remain reachable.
- [ ] Reconfirm whether generic Conversation labels and notices from later scheduled completions are acceptable product behavior.

Related: `2026-07-08-draft-ahead-surface-native-pattern.md`,
`2026-08-13-tell-the-agent-the-screen-is-unfocused.md` (same instinct: the
box is present everywhere, not a page you visit).

> 2026-09-06 (boxholder, via main session): chosen as an Astra task, launching
> when quota allows. The frame it must sit in, his words: "We're going to have
> to work more on embracing 'everything is a card' (which was kind of
> implemented, but not entirely exposed). That is, we basically have a
> windowing (tiled) system where chat is one part of it. And chat is actually
> a bit distinct, because of its ubiquity. But in different forms (dedicated,
> split, 'ambient'? Where that last mode is what we made callouts to support).
> And think about that context that's brought into the chat (things like
> selections, `<chat-app>` or whatever it is), and then also what the chat is
> in (the context, the session, etc)." Four things to design together: the
> tiled system with chat as one tile; chat's forms (dedicated, split,
> ambient); the context brought into chat; the context chat is in.
