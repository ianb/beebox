---
title: "The box as an MCP server that hands out work: a Claude session asks what is due, does it, and posts the result back"
workstream: browser-tasks
area: beebox
needs: [decision]
labels: [mcp, browser-task, connectors, agent-work]
filed-by: agent
discovered-by: Ian
discovered-in: main — boxholder's idea, after the browser-task cadence work landed
---

A `browser-task` card is a prompt, a record schema, and an inbox. Today an
executor reaches it by hand: the boxholder opens the card page in a browser,
clicks Copy, pastes into a local Claude Code session started with `--chrome`,
and at the end the session drives the card's own upload form with
`file_upload` and a Submit click.

Make the box an MCP server and that whole choreography disappears. One Claude
Code session connects two MCP servers — the box for work, Chrome for the
browsing — and the loop is:

1. `list_browser_tasks` → what is open, and what is due.
2. `get_browser_task` → the prompt, the record schema, the watermark, the bound.
3. do the scan in the boxholder's real logged-in Chrome.
4. `submit_browser_task_batch` → records and files, validated and filed.

No card URL to find, no copy button, no drop zone, no wondering whether the
Submit click registered (it did not, once, during the first real run).

## Why this is smaller than it sounds

The tools are thin wrappers over functions that already exist, are already
tested, and are already the things the HTTP surfaces call:

- `listBrowserTasks(boxRoot, nowMs)`
  (`beebox/src/core/browser-task/list.ts:51`) already returns every task with
  its derived lifecycle state — due, never scanned, current, closed — because
  the `rescan-after` work needed exactly that for the dashboard.
- `acceptSubmission(input)`
  (`beebox/src/core/cards/accept-submission.ts:93`) already does the whole
  accept: schema refusal, the card's own validate, MIME sniffed from bytes, a
  server-chosen batch id, the rename into the attach scope, `last-upload`, one
  commit, and rollback on failure. It takes a `boxRoot` and a temp directory,
  not an HTTP request.
- Auth is already resolved for anything mounted in the box scope
  (`beebox/src/webapp/server-box-scope.ts`), which accepts a session, an agent
  bearer, and a mobile device token through one resolver.

So the new code is a transport and a tool vocabulary, not new behavior.

## What it does not solve

MCP does not help with authenticated scraping. The browser still has to be the
boxholder's real Chrome, and the executor still has to be a session running on
their machine. What MCP replaces is the coordination around that: discovery,
auth, and getting the result home. Worth being clear, because "the box is an
MCP server" can sound like it removes the local-session constraint. It does
not.

## Decisions

**1. Which auth.** Device-token pairing is the fit: mint a ticket in box
Settings, redeem once, keep a durable token, send it as a bearer. It exists,
it is revocable per device, it carries identity (a device acts as whoever
paired it), and `resolveMobileRequestAuth` already gates every box route. The
alternative is MCP's OAuth flow, which is more standard for third-party
clients and much heavier for one person wiring up their own box. The agent
loopback token is explicitly not a candidate: its own docblock says teaching
the public front door to accept it would promote a file secret into a network
credential.

**2. How files travel.** MCP tool arguments are JSON, so images are either
base64 inline or fetched some other way. Base64 is simplest and fits the
existing caps, and a batch of event photos is small. The alternative is a tool
that returns a short-lived upload URL the client posts to, which keeps the
streaming route and avoids a third of the bytes. Lean: base64 for the first
version, since it keeps one auth path and one code path.

**3. The one that actually matters: how general is this?** Two readings, and
they lead to different systems.

- *Narrow.* A browser-task MCP server. Three tools, the ones listed above. The
  blast radius of a leaked token is: read the open tasks, submit batches to
  them. Buildable now.
- *General.* The box hands out work of any kind, and browser tasks are the
  first kind. The obvious second is the agent-owned todos that just landed —
  `assigned="agent"` items are, by construction, work with no human waiting
  on them, which is exactly what a worker should be able to pull. Procedures
  are a third. This is the more interesting system and the riskier one.

Lean: build narrow, name generally. `list_tasks`/`submit_result` shaped tools
with a task kind, rather than `list_browser_tasks`, so the second kind does
not need a second vocabulary. But ship only browser tasks, and do not expose a
general read-or-write-any-card surface on the same server — that is a separate
security decision with a much larger blast radius, and nothing here needs it.

## Prior art to check before designing

- The MCP spec's remote-server transport and its auth story, since a box is
  reachable at a public URL and the client is Claude Code.
- Whether Claude Code can hold the box server and the Chrome extension in one
  session, which is the assumption the whole loop rests on. Believed yes,
  unverified.

## Related

- [browser-task card](../../beebox/docs/implemented-plans/browser-task-card.md)
  and [its follow-ups](../../beebox/docs/implemented-plans/browser-task-followups.md).
- [MCP tool: agent launches the conversation into another chat](2026-08-02-mcp-launch-into-chat.md)
  — the opposite direction (the box as an MCP *client*), unrelated except that
  both put MCP in the box's vocabulary.
