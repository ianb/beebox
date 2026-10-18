---
title: "A follow-up check after shipping: the agent leaves a dated promise to come back and see how the change went"
workstream: unattached
area: dev-process
labels: [issues, workflow]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder request
---

When an agent ships a change, nobody comes back to see whether the change
did what it was meant to do in real use. The boxholder wants the agent to
leave a promise to check in later, and a later agent to keep that promise.

Most of this uses two features that exist already:

- **Deferred issues.** A file in `deferred/` with `activate-on:` and
  `category:` becomes a normal open issue on that date. The hourly
  `deferred-issues` schedule moves it (`schedules/deferred-issues/run.ts`).
- **Private issues.** The schedule also activates deferred files in
  `private-issues/` when the mount is present.

## Why private

A follow-up usually means looking at real activity: the boxholder's own
boxes, chats, logs, and usage. That content must not go into the public
issue queue. So the promise goes in `private-issues/deferred/`, and the
check it describes reads real activity there. The public commit that shipped
the change must not link to it (links into `private-issues/` are one-way).

## What the promise contains

- What shipped (commit or merge, public issue if one exists).
- What "it went well" looks like, as things a person can observe: a count
  that should change, an error that should stop, a flow that should get used.
- Where to look, and what not to read.
- When to look (`activate-on:`), chosen so enough real use has happened.

## What is missing

- A step that prompts the agent to write the promise. The finish skill is
  the obvious place: after a land, offer a follow-up when the change has an
  outcome that only real use shows.
- `private-issues/deferred/` does not exist yet. The first promise creates it.
- Pickup: an activated private issue waits in the queue like any other. It
  is not clear whether that is enough, or whether activation should raise an
  alert.

## Not now

The boxholder has considered a split-agent setup: the coding agent has no
access to the boxholder's boxes, but can ask a second agent that does. That
would keep real activity away from the coding agent entirely. Private issues
are enough for now; this is a note for later, not part of this issue.
