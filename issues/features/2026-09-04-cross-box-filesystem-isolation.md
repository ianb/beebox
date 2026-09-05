---
title: "Cross-box filesystem isolation: a box process should not be able to read a sibling box"
workstream: unattached
area: beebox
priority: important
labels: [security]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-cross-box-leak-scan — reviewing security-report §7b
---

Every box on a host runs as the same OS user, so any box process — the
`bbx serve` child, the box's agent, a scheduled script — can read a sibling
box's files and the shared host state (`~/.bbx-session-secret`,
`~/.bbx-auth.json`, the machine secret store, `~/.claude/projects`, the
aggregated `scheduler-stderr.log`). The security report records this as an
accepted risk (§7b channel B, roll-up item 12) because isolation today is
env-level: the hub strips cross-box credentials from each child's env, and
the network channel is tested to zero. The boxholder's position
(2026-09-04): accepted *for now*, but it should be fixed, not lived with.

What "fixed" means is the design question. Candidates, not exclusive:

- **One OS user per box.** The hub spawns each child as its own user; box
  roots are 0700; shared state that must stay shared (the session secret,
  the auth file) is readable only by the hub. The strongest boundary that
  needs no container runtime; the cost is user provisioning in
  `setup-server.sh` / `add-box.sh` and a hub that runs with enough privilege
  to switch users.
- **Per-box containers.** Docker as the stronger option the containment
  issue already names; still worth supporting the no-container path.
- **Allowed-directories control plane** for the agent — the write-side
  sibling,
  [agent-containment-allowed-directories](2026-07-20-agent-containment-allowed-directories.md).
  Necessary for the agent but not sufficient for the box's own processes,
  and expressible only in what Claude Code's settings can enforce.

Whatever lands: the two-box fixture and
`test/webapp/cross-box-probe.doctest.md` are the regression anchor for the
network channel; this needs its own probe for the filesystem channel (a
box-A process attempting a read of box B on disk, asserted to fail), and the
`schedules/cross-box-leak-scan` host audit should then assert the
per-box ownership it verifies. The symlink residual noted in §7b (string
containment follows an in-box symlink to a sibling) disappears with this:
a symlink to an unreadable directory reads nothing.
