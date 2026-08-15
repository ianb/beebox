---
title: "Replace Callback Box's raw Codex app-server client with the official SDK"
workstream: codex-engine-plan
area: callback-box
labels: [engine, codex, sdk, maintainability]
filed-by: agent
discovered-by: Ian
discovered-in: codex-engine-plan follow-up
---

Callback Box currently owns a JSON-RPC client for `codex app-server` and parses
app-server request, response, and notification shapes itself. This preserves the Codex
harness, but it makes Callback Box responsible for a large private protocol surface.

The official `@openai/codex-sdk` now provides typed thread start, resume, streaming
events, tool and file-change items, token usage, structured output, sandbox settings,
additional directories, and cancellation. Codex execution should use that SDK behind
the existing Callback Box engine boundary.

The SDK does not currently expose app-server's thread history, listing, deletion, or an
explicit developer-instructions thread option. Migration therefore needs capability
probes and one quarantined history compatibility module. It must not disguise system
instructions as a user message or scatter raw-protocol exceptions through the codebase.

Plan: [Use the official Codex SDK](../../callback-box/docs/plans/codex-sdk-backend.md).
