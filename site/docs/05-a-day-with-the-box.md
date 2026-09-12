---
description: "What using Bee Box looks like across one day: the morning pass, triage, capture, questions, and chat."
---
# A day with the box

Bee Box is a personal assistant a coding agent runs over a **box**, one
directory of **cards** on a machine you control. This page describes
the shape of a day. Terms are in [the glossary](concepts/glossary.md).

**Overnight and morning.** The engine is idle until something happens. A
**wakeup** is one full sync-and-process pass, started by a schedule or by
hand: it preprocesses new inbox items, runs housekeeping, runs
**connectors** (the code that syncs an external service such as Gmail or
Calendar into the box), creates job cards for what arrived, hands those jobs
to the agent, and pushes the box's git history to your remote if you
configured one. On a fresh box, scheduled runs are off until you turn them
on.

**Triage.** **Triage** is the step that decides where a new item belongs:
file it, archive it, link it to an existing card, or leave it. Classification
carries a confidence level, and a low-confidence item raises a question
instead of being filed silently. Your corrections accumulate as prose rules
at the destination, so the same kind of item is handled the same way later.

**Capture.** On a phone you can open a capture page, record a voice memo,
photograph things while talking about them, or dump a folder of files. The
capture arrives as one card whose body is a timeline of transcribed speech
with the photos placed where they were taken. The agent reads it later and
decides what each part becomes.

**Questions.** When the agent cannot proceed, it writes a question card:
what it is asking, why, which cards are involved, and what to do with your
answer. Answering creates a follow-up job.

**Chat.** Chat is the central surface, in the web interface or through
Telegram, and threads resume across processing cycles. You can also ask for a
page: a custom screen built to show your own cards the way you want to see
them (see [views](capabilities/views.md)).

See [what it can do](06-what-it-can-do.md).
