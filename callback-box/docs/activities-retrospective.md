# Activities — Retrospective

**Status:** the Activities system was removed from callback-box in May 2026. This doc records what was tried, what happened, and what replaced it.

## What was built

An "Activity" was a reusable container for non-default chat shapes (language learning, notebook, guided journaling, etc.). The framework, designed in [activities-design.md](activities-design.md), shipped end to end:

- Backend runtime under `src/activities/` — `Activity` / `ActivityInstance` / `ActivityMode` base classes, registry, session pool, event-bus wiring, fake spawner for tests.
- One built-in activity (Polyglot) with a setup MCP tool and a `main` tutor mode.
- tRPC router (`activities`), CLI command (`cb activity`), and a fake `ClaudeChatSpawner` service so chat-session behavior was testable without spawning a real subprocess.
- Frontend `/$box/activities` page (gallery + create form), per-instance `/$box/activities/$type/$instance` chat page with mode switcher, an `activityChatMachine` XState machine, and a fleet of `activity-chat-*` SSE events.
- In-process MCP wiring (`createSdkMcpServer`) so activity tools closed over the `ActivityInstance` directly without a subprocess hop.

## Why it was removed

The framework was correct but premature. After building Polyglot it became clear that the productive pattern was simpler:

> Build piecemeal features that different instructions can opt into.

Each "activity-shaped" use case turned out to be better served by adding the specific capability (a card type, a schedule template, a chat-feature toggle, a per-directory CLAUDE.md, a slash command, etc.) than by spinning up a typed mode-switching container around it. The container's abstractions — modes, availability functions, per-mode system prompts, in-process MCP servers — were load on every change without paying for themselves at the actual call sites.

In other words: the unit of customization that emerged from real use was a feature flag plus some prose, not a class hierarchy with a session pool.

## What was kept

- Plain chat sessions (`ChatSession`, `ChatSessionRegistry`) — these were already independent of the activity layer and remain the chat surface.
- The schedule system — independent.
- `Agent.invokeStructured<T>(zodSchema)` (added alongside the in-process MCP work) — kept as a general agent feature; it isn't activity-specific.
- The `RecentActivity` dashboard component — unrelated, just a git-log feed.

## What was removed

- `src/activities/` (entire tree)
- `src/cli/commands/activity.ts`
- `src/webapp/trpc/routers/activities.ts`
- `src/frontend/src/pages/ActivitiesPage.tsx`, `pages/activity-chat/`, `machines/activityChatMachine.ts`
- The `mcpConfig` / `ActivityMcpConfig` field on `ChatSessionOptions` and `ChatBackendStartOptions`
- The `activity-chat-*` SSE event names
- `activityRegistry` / `activityChatPool` from the server, tRPC context, SSR context, and `test/helpers/test-server.ts`
- 8 `test/activities-*.doctest.md` files and `test/manual/activity-chat-live.ts`

The original design docs ([activities-design.md](activities-design.md), and references in `narration-mode-design.md`, `stack-decisions.md`, `IMPLEMENTATION.md`, etc.) are left in place as historical record with a banner pointing back here.
