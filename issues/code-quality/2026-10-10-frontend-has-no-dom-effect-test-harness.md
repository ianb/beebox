---
title: "No DOM or effect test harness for frontend code, so effect and event bugs surface only in review or the browser"
workstream: frontend-dom-harness
area: beebox
labels: [testing, frontend]
filed-by: agent
discovered-by: agent
discovered-in: worktree-retrospective — retrospective 20261010-224248
---

Frontend React effects, event handlers, and browser-API wrappers have no
doctest path. Fixes are verified by browser runs and source review only.

Coding feedback: journey-walks-oct/20261009T001800Z-review-adjudicated.md (a
place-pill effect cleanup bug caught only by cross-model review),
blank-assistant-message/20261009T011245Z-implemented.md and
20261009T012259Z-review-adjudicated.md (no fixture-driven chat view to check
streaming without model calls), exhibits-rethink/20261010T231800Z-review-adjudicated.md
(recorder cleanup bug, no DOM test).

Suggested in the entries: `react-dom/client` under a DOM shim for effect
tests, and a fixture-backed chat view.
