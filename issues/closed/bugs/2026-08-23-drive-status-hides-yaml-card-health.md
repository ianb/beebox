---
title: "Drive status hides health fields on current YAML cards"
workstream: connector-integrity
area: callback-box
filed-by: agent
discovered-by: agent
discovered-in: worktree-connector-sync-isolation — independent review of shared Drive tracking
priority: normal
resolution: implemented
---

**Closed 2026-08-25** in 3051bf12: `cb drive status` reads title/modified/status/sheets/lossy from YAML frontmatter via `driveCardSummary()`, XML regexes only as the legacy fallback.

`cb drive status` now uses the shared YAML and legacy parser for `drive-id`, but its title, modified time, status, sheet-tab, and lossy-summary expressions still recognize only the legacy XML card form. Current Google Sheet and Doc handlers write YAML frontmatter.

A current YAML card in `status: conflict` is therefore printed with only its path and Drive ID. The operator cannot distinguish it from a healthy mount on the command intended to summarize Drive state.

Parse the current card structure once and render the same fields for YAML and legacy cards. Add status tests for a YAML title, last-synced value, sheet tabs, lossy summary, and a conflict state.
