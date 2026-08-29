---
title: "Sticky HQ transcription preference"
status: implemented
workstream: transcript-confidence
issues:
  - ../../../issues/closed/features/2026-08-26-sticky-hq-transcription-preference.md
---
# Sticky HQ transcription preference

When a boxholder starts chats in a place where HQ dictation is normally useful, they want that choice inherited without repeating it in every chat. The voice menu must show and edit the current chat, landmark, and box scopes together while leaving the current chat under explicit control.

**Issues addressed:** `2026-08-26-sticky-hq-transcription-preference.md`.

## Stated preferences this plan trades against

The boxholder chose the precedence `chat → landmark → box → built-in off`, a tri-state landmark value (`inherit`, `on`, `off`), and an explicit box on/off default. Parent-scope edits must not alter the open chat. This follows the existing box-policy pattern and the repository rule in `callback-box/CLAUDE.md` to avoid features beyond the task.

## What already exists

- `src/core/chat/features.ts:119` layers new-chat feature seeds. Extend this function instead of creating a second resolver.
- `src/core/landmark/features.ts:30` reads `navigation.chat-app`; retain that card vocabulary.
- `src/core/box/config.ts:12` owns durable box policy. Add one narrow HQ field rather than a general preference system.
- `src/frontend/src/components/chat/VoiceChip.tsx:142` owns the per-chat HQ row. Extend that row in place.
- `src/webapp/box-config-write.ts:74` atomically writes and commits box config. Reuse it.

## Prior art (external)

No external protocol or library behavior is involved. The relevant prior art is the repository's shipped box model policy and landmark feature seeding.

## Tracks / scope

### 1. Resolve new-chat defaults

Add `hqDictationDefault?: boolean` to box config and layer it below landmark and request seeds. Both fresh-send and reserved-chat paths must use the same resolver. Vocabulary lock-in: absent box value means built-in off; landmark absence means inherit.

First implementation chunk: pure resolver plus doctest covering box, landmark, and request precedence.

### 2. Persist parent scopes

Extend the owner-only box-config mutation. Add an owner-only landmark mutation which changes only `navigation.chat-app.hq-dictation`, preserves unrelated YAML/body content, writes atomically, and commits the landmark card. `inherit` deletes that one key.

First implementation chunk: mutation helpers and route/filesystem doctests.

### 3. Put all three controls together

Replace the single HQ menu item with one compact row: `Chat`, `Landmark`, and `Box`. Chat remains a two-state control. Landmark cycles among inherit/on/off. Box is two-state. Loading, unavailable-landmark, mutation-pending, and error states remain legible and accessible.

First implementation chunk: a presentational preference row plus a data-owning VoiceChip integration and real-browser checks at desktop and 375 px.

## Could this be simpler?

A box-only default would require less UI and no landmark writer, but it fails the requested place-specific behavior. A generic scoped-feature preference framework would be broader than the one requested feature. The narrow HQ field plus the existing generic landmark `chat-app` map is the smallest version that covers all three requested scopes.

## Subplans

None; the precedence and storage choices are settled.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Hand-edited box value has the wrong type | yes | loader ignores it | clear warning |
| Landmark YAML is malformed | yes | mutation refuses to overwrite | clear error/toast |
| Landmark has no card | yes | control is disabled | clear in UI |
| Config/card saves but Git commit fails | yes | value remains saved and warning returns | clear toast |
| Parent mutation races another writer | yes | file/card and Git locks serialize writes | clear failure |
| New chat enters through reserve rather than send | yes | both call the shared resolver | covered |

## Agent-flow / user-flow edge cases

- ADDRESSED — wrong landmark value: input is a closed enum and schema validation still applies.
- ADDRESSED — stale landmark: mutation identifies the current directory's card at write time and returns not found.
- ADDRESSED — concurrent writers: existing box/card and Git locking primitives serialize mutations.
- ADDRESSED — hand-edit drift: reads validate; writes refuse malformed files.
- ADDRESSED — fabricated value: only `inherit`, `on`, and `off` cross the route.
- ADDRESSED — validation errors: mutation errors surface through a toast and do not optimistically lie.
- ADDRESSED — transition: absent fields preserve today's off behavior.

## NOT in scope

- Narration persistence; the request is specifically HQ dictation.
- Per-device preferences; the requested third scope is box.
- Retroactively changing existing chats when a parent setting changes.
- A generic scoped-settings framework for every chat feature.

## Open design questions

None. The boxholder settled scope, precedence, and non-retroactive behavior.

## Knowledge audits

Skipped: this is boxholder UI and runtime policy, not new guidance loaded by a box agent.

## What will hold this after it ships

A pure doctest holds precedence. Filesystem/route doctests hold mutation preservation and authorization shape. A frontend render doctest holds labels and states. `bin/browse` verifies the actual menu, keyboard access, and narrow layout.

## Implementation order

1. Resolver and box-config field, with doctest.
2. Landmark/box mutations, with doctest.
3. Three-scope menu row, frontend doctest, and browser verification.
4. Changed tests/lint/typecheck and cross-model diff review.

## Rollout shape

No migration is required: missing values resolve to the existing off default. The work is done when focused doctests, changed tests/lint, typecheck, desktop/narrow browser checks, and cross-model review pass. Physical-device behavior remains a manual check because iOS wraps this web UI.
