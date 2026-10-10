---
title: "Codex worktree launches use -c overrides, which keep sessions off the shared background server"
workstream: unknown
filed-by: agent
discovered-by: Ian
discovered-in: main session — Codex start-up notice in worktree tabs
---

Codex 0.160 runs sessions on a shared background server. A session started with
`-c`, `--enable`, `--disable`, or `--search` cannot use that server. It runs in
embedded mode and prints this notice at start-up:

> Running without the shared background server: command-line configuration
> overrides (-c, --enable, --disable, or --search) requires embedded mode.

`bin/lib/launch-session.sh` (the `codex_args` array) passes three overrides:
the worktree trust level, `project_doc_max_bytes=131072`, and
`developer_instructions=<codex preamble>`. `bin/lib/launch-headless.sh` passes
the first two to `codex exec`.

Sessions work in embedded mode. The cost is that our sessions do not appear in
`codex agents`, and they cannot use `codex remote-control`, which is the Codex
counterpart of Claude Remote Control.

## Approach

Remove the overrides so that sessions use the shared server:

- Write the worktree trust entry into `~/.codex/config.toml` (Codex already
  writes these entries itself).
- Set `project_doc_max_bytes` in the user config, or in a profile (`-p`) if a
  profile is compatible with the server.
- Move the per-worktree preamble (`bin/codex-preamble.ts`) into the generated
  AGENTS.md.

Wait until the agents-md workstream has landed, because it changes how
AGENTS.md is generated. The quick alternative, `--no-daemon`, only silences the
notice. The boxholder chose to wait for the full fix.

Verify in a real Terminal tab, because the Codex TUI does not start in a
headless pseudo-terminal.
