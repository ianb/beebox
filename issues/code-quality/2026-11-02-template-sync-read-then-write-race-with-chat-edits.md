---
title: "Template sync reads a box template, then rewrites it, with no guard against a chat editing it in between"
workstream: unattached
area: beebox
labels: [templates, concurrency, docs-gen]
filed-by: agent
discovered-by: agent
discovered-in: "maintenance-live-tasks plan review (Codex), 2026-11-02"
---

`generateDocs` runs template sync (`syncTemplatesFromSource`) at every chat
start (`src/core/chat/session/run/start-run.ts:117`), every reactor cycle
(`src/core/reactor/engine/cycle.ts:111`), and every docs refresh. For a
tracked template, `installTemplateFile` reads the box's copy
(`src/core/install-template-file.ts:341-343`), decides from that read whether
the box edited it, and later writes the new stock content
(`install-template-file.ts:399`). A chat agent that edits the same file
between the read and the write loses its edit.

The window is milliseconds and needs a template update to be pending, so it
is unlikely. It is not new: docs refresh used to run under box maintenance,
but chat start and the reactor never did.

Smallest fix direction: compare the file's content (or mtime) again
immediately before the write and park the update when it changed, as the
tracker already does for an edited file.
