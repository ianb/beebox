---
title: "A capture's confirmation only exists in the chat, which the user has usually already left"
workstream: capture-chip-states
area: beebox
labels: [capture, chat, notifications]
filed-by: agent
discovered-by: Ian
discovered-in: capture-chip-states — split out of the capture-success issue while fixing it
---

Capture is often the last thing a user does before putting the phone away.
Preparation then takes about a minute. Everything that reports the outcome —
the pending bubble, its delivered face, the capture message itself — lives in
the chat transcript, which by then nobody is looking at.

So the surface that says "this landed" is exactly the surface the user has
left. The chip work
([capture success is invisible](../bugs/2026-08-20-capture-success-is-invisible.md))
made the in-chat report honest and complete; it did not, and could not, move it
somewhere the absent user will see.

## Why this was not folded into the chip fix

It is a delivery-channel question, not a UI-state question. Answering it means
choosing a channel and its rules — a push notification, a badge on return, a
quiet entry in a list of recent activity — each with its own noise budget. The
chip fix would have had to grow a notification path to cover it, which is a
different change with a different failure mode (a capture that succeeds does
not obviously deserve an interruption).

## What has to be settled

- **Is a success worth a notification at all?** A capture that lands is the
  expected case. Notifying on every one trains the user to ignore them; not
  notifying leaves the original problem for the walk-away case. A failure is
  the clearer candidate.
- **Where does a returning user see it?** If the answer is "nowhere new — the
  chat is enough on return", then the remaining gap is only the interval
  between leaving and coming back, and this issue is smaller than it looks.
- **iOS already has a notification path.** Whatever is chosen should reuse it
  rather than invent a second one; see `docs/mobile-contract.md`.
