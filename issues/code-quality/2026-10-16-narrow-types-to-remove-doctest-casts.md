---
title: "Narrower source types would remove the casts left in typechecked doctests"
workstream: unattached
area: beebox
labels: [tests, typescript]
filed-by: agent
discovered-by: agent
discovered-in: doctest-typecheck worktree — fixing about 5,700 doctest type errors, 2026-10-16
priority: backlog
---

The doctest typecheck (`typecheck:doctest`) reached zero with a few commented
casts and local workarounds left in tests. Each traces to a source type wider
than what the code reads, or to a missing test seam. Workers on that branch
reported these; none is a product bug.

Casts a narrower parameter type would remove:

- `ChatRuntime.registry` (`src/webapp/chat-runtime.ts`) takes
  `ChatSessionRegistry`, a class with private members; quick chat and clerk
  tests cast partial fakes of it, of `ChatSession`, and of `ChatRuntime`.
- `speechPlaybackMachine` takes `TTSClient` (private members) and calls only
  `speak`, `prefetch`, `stop`.
- `appendChunk` (`src/frontend/src/lib/audio/tts-client/stream-playback.ts`)
  reads only `appendBuffer` and the listener methods of its `SourceBuffer`.
- `isDiagnosticBypassRequest` (`src/webapp/auth.ts`) reads only `method`,
  `url`, `headers`; `renewMobileSessionCookie` (`src/webapp/mobile-cookie.ts`)
  calls only `setCookie`/`clearCookie`.

Workarounds a source change would simplify:

- `buildProps` (`src/cli/commands/view/command.ts`) builds full `ViewProps`
  but is private; plugin view tests copy it.
- `FakeChatBackend` inherits optional `hasWarm?()` although it always
  defines it; `emitAssistantText` cannot set a `uuid`.
- `buildQueryOptions` (`src/core/agent/invoke/run.ts`) returns
  `Record<string, unknown>`; `BusEvent` is `{ event: string; data: unknown }`,
  not a union keyed by event name.
- `CardSchema.frontmatterSchema` is a bare `ZodType`, so parsed fields are
  `unknown`; `SchemaDelta.summarize` types `base` as `CardSummaryBase`
  although `detail` and `attrs` flow through.
- `MIGRATIONS` has no injection seam; `migration-sweep.doctest.md` casts it
  to push a test procedure.
- `TmpBox.write` (`test/helpers/doctest-helpers.ts`) takes only a string.
- `beebox/tsconfig.json` `lib` stops at ES2023, so tests cannot use
  `Promise.withResolvers` although Node 24 has it.
- About 35 trpc doctests hand-build the same `TrpcContext` and `EventBus`
  fakes; a shared `makeTrpcContext(overrides)` in `test/helpers/` would
  replace them.
