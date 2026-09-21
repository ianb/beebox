---
title: "The front door is an empty text box"
workstream: unattached
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — journey B, a first-time user with no orientation
---

A person opening a box for the first time, told only that this is an AI-powered
app for organising their life, recorded:

> **What I wanted and could not find.** Any sentence anywhere telling me what
> this app is or what I could do with it. No welcome, no examples, no "try
> asking me about…". For something sold to me as "AI for organising your life",
> the front door is an empty text box.

They got everything they eventually understood by *asking the assistant* — what
the app is, where their list lived, what a landmark is. Nothing in the interface
offered it. Their closing line was that they wanted a first screen saying "this
is your box; here's what's in it; tell me about something and I'll keep track of
it" — which the assistant gave them free the moment they asked, and the app
never did.

Directly relevant to gate 7 (first-hour experience) in
[the soft-launch posture](../decisions/2026-07-20-soft-launch-posture.md).

> 2026-09-02 (vocab-sweep): the vocabulary underneath this issue is now
> settled — `beebox/docs/glossary.md` has a user-facing register per term
> (chat not session, Home for the root place, Storage not Inventory, box =
> the user's box and never the app's name for itself, no "agent"/"box
> assistant" in user surfaces). Whatever first-run screen this issue designs
> should use those words. The assistant's persona (personified vs.
> appliance-like) was deliberately left open and belongs to this design.
> Details: `beebox/docs/implemented-plans/vocab-glossary-sweep.md`.

## The vocabulary problem underneath it

The same person, in the first two minutes:

> There is a "Box: journey-b" *and* a "Switch to: Box" — two different things
> both called Box, on a page that already told me I have a "box assistant".
> Three uses of the word box in one small menu and I can't tell any of them
> apart.

Whatever the front door says will be read through that. Worth settling what
"box" means to a user before writing copy that uses it three ways.

## Re-encounter, 2026-09-21 - journey C

A fresh reconnecting-with-friends walk again opened on an otherwise empty chat
with "Start a conversation" and "Type a message". Screenshot 01 confirms the
absence of orientation. The person could proceed because the text box was
obvious and they already had a concrete goal; this run does not establish what
a person without a goal would do. The generated journey slug in the header is
fixture naming, not a new product vocabulary finding.

Evidence: [journey C report](../../beebox/user-stories/journeys/C-reconnecting/reports/2026-09-21.md),
actions 1-3. No onboarding implementation attempted.


> Recovered 2026-09-21 from the August 25 journey A report. This is historical
> evidence, not a fresh re-encounter; current status and priority are unchanged.

## Journey A's closing ask (2026-08-25) — the front door after a successful evening

A second walk, this one a *success* — everything filed correctly, the payoff
question answered in nine seconds — ended with the same tension, stated better
than we have stated it:

> "It offered to build me a page that gathers my reminders in one place. I want
> that, and I want it to be the **front door**: what's out, what I owe, what's
> due. Right now the front door is an empty chat box, and everything I built
> tonight is behind a file path."

Two details that sharpen the requirement:

- The empty-chat front door is the front door of a box that now *has content* —
  this is not only a first-run problem. After a productive evening, day two
  still opens on an empty composer.
- The offer to build the page ("say the word") was itself the walker's
  highlight: "That reframes the whole app for me: it's not a fixed set of
  screens, I can ask for a screen." Whatever the front door becomes, that
  discovery — the box is malleable — currently happens only by luck, deep in a
  failure-recovery conversation.

Related evidence on the same walk: the browse sidebar's empty skeleton
(`recipes/`, `reviews/`, `usage/`, `drive/`, `archive/` — standard box shape,
none of it theirs, none explained): "Suddenly this feels less like an assistant
and more like someone handed me the keys to a filing cabinet." That is the
first-run-experience half of this cluster
([first-run-experience](2026-07-20-first-run-experience.md)).
