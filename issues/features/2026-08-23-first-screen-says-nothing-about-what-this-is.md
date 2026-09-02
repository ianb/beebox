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
> Details: `beebox/docs/plans/vocab-glossary-sweep.md`.

## The vocabulary problem underneath it

The same person, in the first two minutes:

> There is a "Box: journey-b" *and* a "Switch to: Box" — two different things
> both called Box, on a page that already told me I have a "box assistant".
> Three uses of the word box in one small menu and I can't tell any of them
> apart.

Whatever the front door says will be read through that. Worth settling what
"box" means to a user before writing copy that uses it three ways.
