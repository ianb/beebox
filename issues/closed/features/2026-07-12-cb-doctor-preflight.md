---
title: "cb doctor — one preflight command for every install path"
workstream: unknown
design: ../../../research/openclaw-hermes/deep-installation.md
resolution: implemented
---

Both OpenClaw (`openclaw doctor`) and Hermes (`hermes doctor`) ship a doctor
command, and every one of their install docs ends with it — it's what makes
installer failures self-diagnosing. callback-box has the pieces scattered:
a health probe that's skipped on macOS (`src/webapp/trpc/routers/health.ts`),
external-binary assumptions buried in `src/core/agent-guide/chat.ts:13`, and
git-lfs hooks that degrade silently when lfs is missing.

Checklist a `cb doctor` should run:

- Node version matches `callback-box/.nvmrc` (note: `deploy/setup-server.sh`
  currently installs Node 22 while `.nvmrc` pins 24 — reconcile)
- workspace installed from the monorepo root (hoisted node_modules present)
- `pandoc`, `magick`, `pdftotext` on PATH
- `git-lfs` installed AND filters active in the box repo
- Claude credentials present/unexpired (`~/.claude`, including the macOS
  keychain path the health probe currently skips)
- box passes `cb validate`; `.cb-box` marker sane

This is Track F piece 1 of
`callback-box/docs/plans/source-available-release.md` (preflight + actionable
error + macOS probe fix) grown into a named command instead of a buried
run-path check. The run-path preflight should share the same checks.
