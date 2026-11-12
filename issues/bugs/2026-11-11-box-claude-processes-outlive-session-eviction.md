---
title: "A box's Claude Code processes multiplied during a subagent-heavy turn and outlived the session's idle eviction"
workstream: unattached
area: beebox
labels: [chat, memory, production]
filed-by: agent
discovered-by: agent
discovered-in: "main checkout — production memory outage, 2026-11-11"
---

On 2026-11-11 one production box ran a large eval in chat. The turn launched
6 Agent calls, and 14 subagent transcripts were written over about ten
minutes. The kernel's out-of-memory report 15 minutes later listed, for that
box's user alone, 35 `claude` processes and 45 Node processes (reported as
`MainThread`), holding about 2.1 GB of RAM and 2.9 GB of swap. The host has
4 GB of RAM. Other boxes had 1 to 4 processes each.

The box's chat registry evicted the session as idle and logged "Stopping
run" and "Reaping idle warm slot". Host memory did not fall afterwards, and
swap stayed full until a hard reset almost an hour later. So the processes
appear to have outlived the session that started them.

The host-side damage is fixed separately: every box unit now caps its swap,
and all box units share one slice with a memory ceiling
(`beebox/deploy/systemd/beebox-boxes.slice`, `box-sandbox.conf`). A box like
this one now hits its own limit. The questions left are about the engine:

- **What were the 35 `claude` processes?** Background subagents may each run
  as their own Claude Code process with their own MCP servers (the Node
  processes). Or a process from each earlier turn or warm slot stayed alive.
  Reproduce on a test box: a turn that launches several background
  subagents, then count processes during the turn, after "Turn complete",
  and after idle eviction.
- **Does eviction or stop kill the whole process tree?** If background
  subagents survive `interrupt()` and eviction, they keep their memory until
  the box unit restarts. Related:
  [chat's stop button and background subagents](../decisions/2026-08-25-chat-stop-and-background-subagents.md).
- **Should a box limit concurrent subagents** to fit its memory budget
  (about 250 to 300 MB per Claude Code process, measured 2026-11-03 in
  `box-sandbox.conf`)?

Evidence (on the server, previous boot): `journalctl -b -1 -k` around
20:34 UTC for the out-of-memory task list, and `sar -r` / `sar -S` from
`/var/log/sysstat` for memory and swap over time. The box is not named here;
the boxholder knows which one ran the eval.
