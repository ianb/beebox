---
title: "Chat assistant as job dispatcher"
workstream: unknown
area: beebox
resolution: wontfix
---

> Closed 2026-09-05 as `wontfix` (never held): the reactor and job cards (`_bookkeeping/jobs/`, `src/core/reactor/`) were in place the day before this was filed and are the dispatch mechanism it asks for; the agent guide already tells agents to create job cards for async work. The CLI status-query framing was never built as such.

The chat frontend's system prompt should instruct the assistant to *dispatch jobs* to start tasks rather than executing them synchronously inside the chat turn. Plus give the assistant CLI query tools + docs to check: what's currently running, what's scheduled, when something last ran. This makes long-running work feel responsive in chat (assistant reports "I've queued X", user can ask "what's running?") and keeps the chat session from holding resources.
