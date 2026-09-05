---
title: "The retired cb command should fail with a direct pointer to bbx"
workstream: unattached
area: beebox
labels: [rename, cli, agent-ux]
filed-by: agent
discovered-by: Ian
discovered-in: main session — noticing that agents still carry vestiges of the pre-rename command
priority: important
---

Some agent context, old transcripts, scripts, and learned behavior still refer
to the pre-rename `cb` command. Today those calls can fail as a generic
command-not-found error. That does not tell the agent that the interface moved
or how to recover.

Install a small `cb` tombstone command beside `bbx`. It must:

- print a concise error that says the command was renamed and directs the
  agent to use `bbx`;
- exit nonzero;
- never proxy, translate, or execute the requested operation;
- behave the same for no arguments, `--help`, and an attempted subcommand;
- be available through the same development, installed-package, and production
  command paths where `bbx` is available.

The hard failure is deliberate. Automatic forwarding would keep stale agent
knowledge and scripts alive indefinitely. A specific error lets the caller
correct itself while preserving the rename boundary.

Coverage should prove both sides of the contract: stale invocations receive
the migration message, and no old command can accidentally perform work. The
tombstone can be removed later with the other temporary name-change
compatibility after the transition window closes.

