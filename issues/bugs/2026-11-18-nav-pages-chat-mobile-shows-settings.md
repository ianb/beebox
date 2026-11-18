---
title: "nav-pages: phone \"chat\" checkpoint captures the Settings page"
labels: [tours]
workstream: tour-check
area: beebox
filed-by: agent
discovered-by: agent
discovered-in: worktree-tour-check — weekly tour check run 20261118-161345
priority: normal
---

The `chat` checkpoint's mobile screenshot shows the Settings page (the system
theme grid), the same view as `settings.mobile.png`; the desktop screenshot
shows chat. The checkpoint's expectations did not fail, so either the phone
pass lands on the previously open tab or the expectations do not tell chat from
settings. The tour check found no landing that explains it.

## Evidence

- Tour `nav-pages`, checkpoint `chat`, mobile:
  `beebox/test/tours/.artifacts/nav-pages/2026-11-18T22-44-40-162Z/chat.mobile.png` (compare
  `settings.mobile.png`).
