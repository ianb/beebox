---
title: "Engine-aware chat model selection"
status: implemented
workstream: codex-engine-plan
issues: []
---

# Engine-aware chat model selection

When a box contains chats owned by different native harnesses, the boxholder wants the
chat menu to show the current engine and only models that engine accepts. A model choice
must affect that chat without leaking into another chat or provider.

## Stated preferences this plan trades against

- Principles 1 and 3: model IDs use an engine-indexed registry and are validated at the
  mutation boundary.
- Principle 4: an invalid or stale model fails visibly instead of reaching a harness.
- Principle 8: frontend labels and backend validation share one isomorphic registry.
- Principle 10: option selection, validation, and persistence paths have focused tests.
- The boxholder explicitly accepts hard-coded Codex models for now.

## What already exists

- `InteractiveChat-helpers.ts` has a Claude-only static model list.
- `resolveChatEngine` returns the engine pinned in chat history.
- `ChatSession` passes its persisted model override to either native backend.
- `.callback-box/chat-model.json` stores one box-wide override. This plan replaces that
  behavior for web-chat registry sessions with per-session files.

## Prior art (external)

No external adapter is needed. Both native harness calls already accept a model string.
Codex app-server can list models, but the boxholder chose a hard-coded first version.

## Tracks / scope

### Track 1 — Shared engine model registry

Define Claude and Codex option lists in shared code. Claude retains its current choices.
Codex offers its default plus `gpt-5.6-sol` and `gpt-5.6-terra`. Export lookup and
validation helpers for both server and frontend.

### Track 2 — Provider-aware status and mutation

Return the pinned engine from chat status; the frontend derives its options from the
shared registry. Reject a model not registered for that engine in `chat.setModel`
before persistence or restart.

### Track 3 — Per-session persistence and menu

Store web-chat overrides under `.callback-box/chat-models/<session-id>.json`. Show the
engine in the model panel and render only its options. Keep the old default model file
for non-registry callers and field-test compatibility.

## Could this be simpler?

Two static frontend arrays would change the visible menu but would not stop a crafted
mutation or the box-wide override file from crossing engine boundaries. The shared
registry and per-session file are the minimum version that makes the displayed contract
true.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Claude model is sent to Codex | Planned | Mutation rejects it. | Clear |
| One chat changes another chat's model | Planned | Session ID selects a distinct file. | Clear |
| Legacy chat lacks an engine | Existing | It resolves to Claude. | Declared fallback |
| Stored model is removed from registry | Planned | Menu labels it unavailable; next explicit selection replaces it. | Clear |

## Agent-flow / user-flow edge cases

- Changing the box engine does not change an existing chat's model menu.
- A new chat uses its pinned engine after the native session ID is assigned.
- Switching models restarts only that live chat subprocess under existing behavior.

## NOT in scope

- Dynamic Codex model discovery.
- Engine switching inside an existing chat.
- Migrating the old box-wide override into every historical chat.
- Model selection before a new chat has a native session ID.

## Open design questions

There are no open questions for this implementation. Dynamic discovery can replace the
Codex registry later without changing the API response shape.

## Knowledge audits

No knowledge audit is needed. The menu exposes the choices directly.

## Implementation order

1. Add the shared registry and tests.
2. Add per-session model-file resolution.
3. Extend status and validate mutations. Complete.
4. Make the menu engine-aware and verify it in the browser. Complete for Claude;
   the Codex option list is covered by the shared-registry test without spending a turn.
5. Run cross-model review and finish checks. Complete; the review's actionable findings
   around fresh chats, stale responses, field-test compatibility, cleanup, and instruction
   markdown linting were addressed.

## Rollout shape

No card migration is required. Existing `.callback-box/chat-model.json` remains for
legacy/non-registry callers but no longer controls registered web chats.
