---
title: "bbx session refuses to combine a session ID with --since, so there's no way to view only the new turns of one named long-running session"
workstream: unattached
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: main — production box feedback triage (bbx feedback)
---

`bbx session` explicitly rejects combining `--since` with a session ID (or
`--latest`): "`--since cannot be combined with a session ID or --latest. Use
one or the other.`" (`beebox/src/cli/commands/session.ts:136-139`). `--since`
without a session ID instead does a "windowed multi-session view"
(`session.ts:206`).

For a scheduled catch-up across several long-running sessions (e.g. a
recurring procedure that needs to review only what's new in each of a few
specific sessions), `--list` can identify which sessions are relevant, but
there is no way to then ask for only the new portion of one named session —
only the combined multi-session `--since` view, which can truncate when
several sessions have been active.

## Suggested direction

Allow `--since` together with an explicit session ID (a per-session
"new-since-marker" selector), instead of only supporting it in the
multi-session windowed mode.

## Why resolution is not obvious

This is a small, additive CLI change with no correctness risk noted; the only
open question is what output shape a single-session `--since` view should
take relative to the existing multi-session windowed view, which is a design
choice for whoever owns `bbx session`.
