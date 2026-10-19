---
title: "Narrower source types would remove the casts and untyped doubles left in tests"
workstream: doctest-typecheck
area: beebox
labels: [tests, typescript]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck worktree — fixing about 5,700 doctest type errors, 2026-10-16
priority: backlog
---

Status 2026-10-16 (workstream `doctest-typecheck`): most of this list is done.
Done: the Fastify request/reply parameters (`DiagRequest`, `CookieReply`),
`SpeechClient` for the speech playback machine, `buildQueryOptions` returning
the SDK's `Options`, `SchemaDelta.summarize`'s base type, an exported
`buildProps`, `emitAssistantText`'s `uuid`, `TmpBox.write` taking bytes, ES2024
in `lib`, a shared `trpcContext()` helper (60 doctests), and `BusEvent` as a
union keyed by event name.

Declined, because each would move a cast into source or add test-only
plumbing to remove one contained, commented cast in a test:
- a typed `CardSchema.frontmatterSchema` (the frontmatter type depends on a
  body field known only at runtime and on injected global fields);
- an injection seam for `MIGRATIONS` (it would thread a test-only option
  through the sweep and migrate paths).

Open: `ChatRuntime.registry` (`src/webapp/chat-runtime.ts`) takes
`ChatSessionRegistry`, and `getOrCreate` returns `ChatSession`; both classes
have private members, so quick-chat, clerk and capture tests build partial fakes of
them, of `ChatRuntime`, and of `ChatSession`. Narrow interfaces for the
registry and session surface the runtime uses would remove those casts. That
is a refactor of the chat runtime's types, larger than the rest of this list.
