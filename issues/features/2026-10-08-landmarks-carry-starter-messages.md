---
title: "Landmarks carry starter messages: ways to kick off a conversation and things to do, offered from the landmark"
workstream: unattached
area: beebox
needs: [design]
labels: [onboarding, landmarks, chat]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-imbue-studio-research — after a hands-on session with Imbue Studio's Getting Started window
---

The boxholder (2026-10-08): custom landmark starter messages could go in
landmarks, as ways to kick off the conversation or things to do.

Today an opener is a string in the bound directory's briefing card
(`beebox/docs/implemented-plans/first-run-openers.md`): shown only in an
empty new chat, click-to-send, curated by the retrospective. Two tensions:

- **It is on the wrong card.** `beebox/docs/landmarks.md` separates the
  briefing (aimed at agents, "context every agent needs to know about this
  spot") from the landmark (aimed at humans navigating the UI). An opener is
  human-facing copy, yet it lives on the agent-facing card.
- **It is only a zero-state.** A person at a landmark with an established
  chat sees nothing. The useful moment is "I am here, what could I do here?",
  which is a landmark question, not an empty-chat question.

Imbue Studio's answer, for reference
([research](../../research/imbue-studio/starter-templates.md), section 5):
a Getting Started window beside the chat whose tiles ("Build a new app",
"Connect your data", "Set up a routine", "Make sense of a pile of stuff") each
seed one chat message through one contract, and every starter's README ends
in an "Ideas for making it yours" list. The tiles are the same mechanism as
openers, placed where a person looks instead of in the empty composer.

## Shape to design

- A landmark card carries `starters:` (name to settle against the glossary):
  each a short label, the message it sends, and whether it starts a new chat
  bound to the landmark or drafts into the current one. "Things to do" is the
  same list with a different verb; a starter can also point at a card or a
  procedure instead of a message.
- Shown from the landmark: in the landmark's menu and header on web and on
  the phone, and as the empty-chat openers for chats bound to it, so the
  existing zero-state becomes one reader of the same list.
- Owned by the agent as briefing openers are, curated by the retrospective
  step that already curates openers; stock landmarks (root, Storage) ship a
  stock list.
- Migration: the briefing `openers:` field becomes the landmark's list, or
  the chat reads both during a transition. The fresh-session suppression bug
  ([fresh-chat-reservation](../bugs/2026-09-21-fresh-chat-reservation-suppresses-openers.md))
  applies to whichever reader survives.

Related: a starter pack's own kick-off list is the natural first content of
this field ([starter manifest](2026-10-08-starter-manifest-and-scripted-first-turn.md)).
