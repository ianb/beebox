---
title: "Agent \"give up\" mechanism"
workstream: unknown
area: beebox
---

When a Claude Code agent can't complete a task, let it write `.beebox/agent-failure.json` with `{ reason, phase, sessionId }` before exiting. The caller (wakeup cycle, procedure engine, job dispatcher) detects the marker, reverts any uncommitted changes in the box, logs the failure, and moves on. Prevents half-finished work from getting committed and masks "silent success" failures where the agent bailed without indicating it.
