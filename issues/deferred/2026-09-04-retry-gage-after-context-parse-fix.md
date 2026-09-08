---
title: "Retry gage (Claude Code session scanner) once gageml/gage#16 is resolved"
workstream: unattached
labels: [external-tool]
filed-by: agent
discovered-by: Ian
discovered-in: main session — boxholder filed the upstream bug and wants to try the tool later
activate-on: 2026-09-15
category: watch
---

> Re-check 2026-09-08 (first): gageml/gage#16 still open, no comments, no release after 0.1.0 (2026-09-04). Re-deferred one week to 2026-09-15; next backoff two weeks, then four.

gage (https://github.com/gageml/gage) scans Claude Code sessions with
scanners such as `code-review`, `general`, `hidden-thinking`, and
`session-retention`. A trial on 2026-09-04 (driven by a Claude Code agent, not
by hand) failed: gage 0.1.0 cannot parse Claude Code 2.1.260's markdown
`/context` output (the `1m` window has no `k` suffix), so it disabled every
agent-calling scanner and reported a clean-looking scan with no findings. Two
smaller ones from the same trial: `gage session list --since` overflows an i64
timestamp, and non-TTY runs exit with "not connected".

Upstream bug, filed by the boxholder: https://github.com/gageml/gage/issues/16
(open, no comments, as of 2026-09-04).

## When this activates

This is a check, not a go-signal. Look at the upstream issue and the gage
release notes:

```
gh issue view 16 -R gageml/gage --json state,comments,closedAt
gh release list -R gageml/gage --limit 5
```

- **Unresolved, no movement:** move this file back to `deferred/` with a new
  `activate-on` further out each time — a week, then two, then four; after
  roughly three re-defers with no upstream activity, ask the boxholder whether
  to keep watching or close it).
- **Fixed or a release that mentions `/context` parsing:** tell the boxholder
  and offer to rerun the trial. The rerun is the same shape as the original:
  install the new version, `gage init -y`, `gage scan <session-id>` with the
  four scanners above on a real monorepo session, and record what it finds in
  `research/` as an external-tool review (see `research/CLAUDE.md`). Run it
  under a pseudo-terminal until the non-TTY report is fixed too.
