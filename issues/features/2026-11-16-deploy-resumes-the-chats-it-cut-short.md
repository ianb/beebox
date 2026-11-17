---
title: "A deploy resumes the chats it cut short"
workstream: unattached
area: beebox
labels: [deploy, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — long-running tasks stall after deploys, 2026-11-16
---

A deploy or restart ends long-running chat work, and the work stays stopped. The boxholder must notice that a chat stalled and send a message to start it again. Often they do not notice for a long time.

The deploy knows which chats it ends. It should start each one again after the box comes back up and tell the agent why. The agent decides what to do next. It can continue the task, check what finished, or tell the boxholder that a step must not be repeated. No mechanical resume logic is needed.

## What exists

[Session lifecycle](../../beebox/docs/chat/sessions.md) and the [termination notes plan](../../beebox/docs/implemented-plans/chat-termination-notes.md):

- The deploy closes admission and waits for accepted work to finish. The drain limit is ten minutes ([deploying](../../beebox/docs/server/deploying.md#the-maintenance-boundary)).
- A run with live background tasks is ended after about one minute. The session keeps a record under `.beebox/chat-run-ended/` with the cause. An unstamped record means the server crashed.
- The agent sees the record as a `<run-ended>` element, but only on the next turn the boxholder sends.

## Change

- After the box reopens, start one turn in each chat that has a deploy-stamped (or crash) record. The turn carries the existing `<run-ended>` element; it is already a unique term, so no new marker is needed.
- Write the record for every turn that a deploy ends, not only for runs with background tasks.
- Shorten the drain limit by a large amount, possibly to one or two minutes. When ended work resumes by itself, a long wait gives little value and makes each deploy slower.

## Open questions

- Which chats to resume: only chats that were mid-turn or had live tasks. Skip a record that is old, for example from a crash some days ago.
- Many resumed chats at the same time after a deploy. Possibly start them one at a time.
- Does the boxholder see the resumed turn as a new user message, or as a system marker in the transcript?
- A chained deploy (two landings close together) can end the resumed turns again. The second resume must not stack a second note.
