---
title: "Show retranscriptions and audio consultations on the chat message"
status: draft
workstream: transcript-confidence
issues:
  - ../../../issues/features/2026-08-12-show-retranscription-in-chat.md
---

# Show retranscriptions and audio consultations on the chat message

When the agent runs `cb chat retranscribe`, the user's bubble keeps the
realtime transcript while the agent answers from a better one — the person
reads one thing and is answered about another. This plan makes the improved
text appear on the message with an indicator (original recoverable), and adds
a small badge when the agent analyzed the audio (`ask-about-audio`). Visual,
in-chat; the durable transcript is not rewritten.

## Job stories

- When I dictate a message and the agent retranscribes it (often prompted by
  an `<unsure>` span), I want my bubble to show the corrected text with a
  mark that it was corrected, so the agent and I are visibly talking about
  the same words — and I can still see what the realtime pass heard.
- When the agent goes back and listens to my recording to answer a question,
  I want a small trace on that message, so "it checked the audio" is a fact I
  can see rather than infer from its answer.

## Stated preferences this plan trades against

- `docs/engineering-principles.md` — #1 (types are structure: two precise
  event types over one with optional fields), #3 (validate at boundaries:
  the report route parses with zod), #4 (resilient and never silent: a
  report that can't be delivered degrades to today's behavior — stdout only
  — with a warn), #8 (one way: message identity is the emission id
  everywhere), #12 (the maintainer is usually an agent).
- Monorepo memory `feedback_minimal_concepts_prefer_primitives`: identity
  rides the existing embedded-attribute convention on the `<speech>`
  wrapper; the indicator reuses the existing `AckBadgeCluster` badge+popover
  affordance; events ride the existing bus→`events.subscribe` pipe. No new
  channels or registries.
- Precedents: `stt="deepgram"` attribute stamping (`chat-assemble.ts`,
  landed this workstream); `AckBadgeCluster` (`ack-badge.tsx:19-95`);
  transient bus events handled in `InteractiveChat-ws.ts:82-133`.
- Boxholder's standing decision on the issue: *"Explicitly not required to
  alter the durable transcript — visual only, in the chat, is enough."*

## What already exists

- **Loopback audio fetch with a text-only identity** —
  `src/cli/commands/chat-audio.ts:90-142` (`fetchLastAudio`) long-polls
  `POST /api/chat/last-audio/request`
  (`src/webapp/routes/chat-last-audio-routes.ts:58-87`), which broadcasts
  `chat-last-audio-request` box-wide; the fulfilling tab answers with
  audio + `recordedAt` + `text` only (`last-audio.ts:66-72`). **The
  emission id keying the tab's retention store
  (`retainVoiceAudio(emission.id, …)`, `InteractiveChat-voice.ts:126`) is
  read locally and dropped** — the CLI ends up with no id and no session.
  Reused: the same request/response conversation, extended to carry the id.
- **`messageId` = emission id on the wire** — `chat-assemble.ts:117`; used
  server-side only for send dedup (`chat-send-routes.ts:202-220`), never
  persisted into the transcript. Reused as the one message identity.
- **Transient bus events to tabs** — `eventBus.emitTransient` →
  `events.subscribe` (`src/webapp/trpc/routers/events.ts:58-120`) →
  `InteractiveChat-ws.ts` `handleSecondaryEvent` (`:82-133`), with
  per-payload session scoping via `forSession` (`:59-61`). Reused: two new
  transient event types follow this exact shape.
- **Badge + popover affordance** — `AckBadgeCluster`
  (`ack-badge.tsx:19-95`), corner badges on the user bubble
  (`user-message.tsx:276`) opening a small popover. Reused as the
  *pattern*, not the code — see Track 3's badge-rendering note.
- **Optimistic-entry reconciliation** — pending entry `uuid = messageId`
  swapped for the SDK uuid by text matching
  (`src/frontend/src/machines/chat-shared.ts:73-110`; pending entries get `uuid: event.messageId` in `chat-actions.ts:42-50`). This is why an overlay keyed by emission id
  needs its own entry-resolution (Track 3): nothing maps emission id → SDK
  uuid today.
- **Embedded-attribute stripping** — the `<speech …>` shell strip is
  attribute-generic (`message-parsing.ts`, pinned in
  `user-message-text.doctest.md` for `stt=`), so a new attribute needs no
  display work to stay invisible.
- **`cb chat retranscribe` / `ask-about-audio` / `get-last-audio`** —
  `chat-audio.ts:149-352`: all three print to stdout and know no session or
  message id. Reused: `retranscribe` and `ask-about-audio` gain one report
  step (`get-last-audio` deliberately does not — see Vocabulary lock-ins);
  output text of all three is unchanged.

## Prior art (external)

Searched 2026-08-15 (session research report):

- **Edited-message indicators**: iMessage shows "Edited" with tap-to-view
  full revision history; WhatsApp/Telegram/Slack show an "edited" label with
  no recoverable original. iMessage's label+reveal is the one precedent for
  "original recoverable" and is the model here (badge → popover showing the
  realtime text). [iMessage edit history](https://www.iphonelife.com/content/how-to-edit-messages-iphone-view-edit-history),
  [WhatsApp edit](https://techcrunch.com/2023/05/22/whatsapp-now-lets-you-edit-messages-with-a-15-minute-time-limit).
- **Transcript upgraded in place**: no product documents a visual marker for
  "this text was re-transcribed better" — Google Recorder's "Transcribe
  again" shows only a transient processing card
  ([9to5Google](https://9to5google.com/2023/12/15/pixel-recorder-transcribe-again/)).
  Open design space; nothing to copy, which supports keeping the marker in
  our existing badge vocabulary rather than inventing chrome.
- **"Assistant consulted your audio"**: no direct product prior art; the
  nearest shape is the OS microphone recent-access log (tap the indicator →
  see who used the mic when)
  ([Android privacy indicators](https://source.android.com/docs/core/permissions/privacy-indicators)) —
  a retrospective, tappable disclosure, which is exactly the badge+popover
  form chosen.

## Vocabulary lock-ins

- **`message-id="msg-…"` attribute on the `<speech>` wrapper** of voice
  sends, stamped at assemble beside `stt=`/`diarized=`. It is the emission
  id — the same value that keys the audio retention store and the wire
  `messageId` — persisted into the transcript text so the message is
  addressable after the pending→authoritative uuid swap and across reloads.
  Typed sends don't carry it (no recording to point back at). Display
  strips it with the shell (already attribute-generic); the agent prompt
  notes it as system metadata to ignore.
- **Two transient bus events** (added to `EventMap` + `eventSchemas` in
  `src/core/event-bus-schemas.ts` — `event-bus.ts` re-exports them):
  - `chat-retranscription` `{ sessionId, messageId, newText, service?,
    diarized, recordedAt? }` — a successful HQ pass over a message's audio.
    `service` is the **resolved** service name; the CLI today only knows the
    requested option and prints "(box default)" when unset
    (`chat-audio.ts:320,347`), so Track 2 resolves it (config lookup or a
    `service` field on the HQ result) and omits the field when genuinely
    unknown — the badge never shows a placeholder.
  - `chat-audio-consulted` `{ sessionId, messageId, command:
    "ask-about-audio" }` — the agent analyzed the recording without
    producing replacement text. (`get-last-audio` was considered and cut
    from v1 — a bare fetch is plumbing, not analysis, and badging it as
    "listened" overclaims; the `command` enum extends if wanted.)
  - Both `sessionId` and `messageId` are **required non-empty** — the report
    route rejects otherwise, and the frontend ignores these events while its
    own session id is still null (`forSession` passes on null,
    `InteractiveChat-ws.ts:58-61`, which would otherwise match everything).
- **Response headers on the last-audio fetch**: `X-Message-Id` and
  `X-Session-Id`, alongside the existing `X-Recorded-At`/`X-Message-Text`;
  the fulfilling tab sends `messageId` and `sessionId` multipart fields it
  already knows.
- **`POST /api/chat/audio-review`** — the CLI's report-back route (raw
  Fastify beside the last-audio routes; zod-validated body), which emits the
  matching transient event. Raw rather than tRPC because the caller is the
  CLI loopback, same as `last-audio/request`. **Auth, stated concretely**:
  the route sits behind the same server-level auth as the rest of `/api`
  and additionally accepts the CLI bearer the way `last-audio/request` does
  (`chat-audio.ts:44,109`) — implementation reads the actual guard and
  matches it. Worst-case abuse is bounded: the payload can only paint a
  transient overlay on the caller's own box's tabs; it mutates nothing.
- **Delivery is best-effort, stated honestly** (cross-model review): a
  successful report POST means the event was emitted, not that any tab saw
  it — `emitTransient` notifies only currently-connected subscribers
  (`event-bus.ts` transient path; `events.ts:84-98` coalescing), with no
  ack. A tab that disconnects between fulfilling the audio request and the
  report simply misses the indicator. Acceptable for a visual-only feature;
  recorded in the failure-modes table.

## Tracks / scope

Ordered by implementation dependency.

### Track 1 — identity thread-through

- **What**: `chat-assemble.ts` stamps `message-id` on voice-send `<speech>`
  wrappers. The fulfilling tab (`last-audio.ts:54-81`) adds `messageId` and
  `sessionId` multipart fields; `chat-last-audio-routes.ts` parks them on
  the pending fulfillment (`core/last-audio-pending.ts` shape gains the two
  fields) and returns them as `X-Message-Id`/`X-Session-Id`;
  `fetchLastAudio` (`chat-audio.ts:77-142`) surfaces them on its result.
- **Why**: every later step needs "which message, which session," and today
  that information dies one hop from where it's known.
- **Direction detail**: the retention store already holds the emission id as
  its key; `fulfillLastAudioRequest` also knows its own tab's `sessionId`
  (the same value `InteractiveChat-ws.ts` scopes by). Both are additive,
  optional fields end-to-end — an old tab answering without them degrades to
  today's headers, and the CLI treats their absence as "cannot report"
  (fail-open to current behavior).
- **First chunk**: the whole track — attribute stamp + doctest (extend
  `emission-assemble.doctest.md` pinned serializations), multipart fields +
  headers + pending-shape change with a route doctest.

### Track 2 — report route and events

- **What**: add the two events to `EventMap`/`eventSchemas`; add
  `POST /api/chat/audio-review` (zod body = one of the two payloads,
  discriminated on `kind`), which `emitTransient`s the matching event.
  `retranscribe` (on HQ success, when it has `X-Message-Id`/`X-Session-Id`),
  and `ask-about-audio` (on answer success) each POST
  their report; `--file` runs have no id and skip silently. stdout output of all three commands is byte-unchanged.
- **Why**: the CLI holds the only copy of the HQ text; a report hop is the
  minimal way to reach the tabs.
- **Failure posture**: a failed/unreachable report logs a one-line
  `console.warn` and the command still succeeds — the report is
  best-effort; the agent's own reading of the result is the primary
  function and must not break with the UI (principle #4).
- **First chunk**: events + route + doctest (`makeTestServer()` tier),
  then the three CLI call sites.

### Track 3 — frontend overlay and badges

- **What**: `InteractiveChat-ws.ts` gains handlers for the two events
  (session-scoped: apply only when the tab's own session id is non-null AND
  matches), feeding a per-chat overlay store: `Map<messageId,
  { retranscription?: {newText, service?, diarized, recordedAt?},
  consulted?: Set<command> }>`. `UserMessage` resolves its entries against
  the store: an entry matches when its raw text carries
  `message-id="<id>"` (regex, same style as `userIdentity()`,
  `session-entry.ts:58-69`; the raw wrapper text IS present in
  `SessionEntry.content` — stripping happens at render) or — for a
  still-pending stub — when `entry.uuid === messageId` (pending entries are
  built with `uuid: event.messageId`, `chat-actions.ts:42-50`).
- **Replacement is scoped to the display text only** (cross-model review
  finding): the overlay swaps the string handed to `UserMessageText` for
  the matched entry's text block — attachment chips, images,
  capture/upload summaries, selection pills, and the debug view all keep
  deriving from the ORIGINAL text; the popover shows the original body
  ("realtime transcript", iMessage-style recoverability) plus the service
  when known. A consulted match renders a badge only (popover: "the agent
  analyzed this recording"). Diarized new text renders as plain multiline
  text.
- **Badge rendering**: follows `AckBadgeCluster`'s corner-badge + popover
  *pattern* (`ack-badge.tsx:19-95`, `user-message.tsx:276`) but is its own
  small component — the ack cluster is typed around `AckIndication`/ref
  links and its data comes from parsing agent replies, which this is not
  (review finding: pattern reuse, not code reuse). The two clusters share
  the corner row; ack badges keep precedence order, audio badges append.
- **Reload behavior — decided deliberately** (the issue asks for this): the
  overlay is in-memory; after a reload the bubble reverts to the original
  text with no trace. Accepted per the boxholder's standing "visual only is
  enough." The `message-id` attribute persists in the transcript, so a
  future durable extension (a machine-owned husk field beside `review-span`,
  `src/schemas/chat.ts:22-27` precedent) can be added without revisiting
  identity — named in NOT in scope.
- **Un-swapped safety**: `newText` renders through the normal text path
  (React-escaped; `UserMessageText` still parses `<unsure>` if present —
  HQ text has no marks, so in practice it renders plain).
- **First chunk**: overlay store + event handlers + entry resolution with a
  frontend doctest; then the badge/popover rendering + `bin/browse` visual
  check.

### Track 4 — agent guidance touch-up

- **What**: one sentence in `src/core/chat/session/prompts.ts` beside the
  existing wrapper documentation: `message-id` is system routing metadata —
  ignore it, never fabricate it. And one sentence extending the existing
  retranscribe guidance: a successful retranscription is shown to the user
  automatically, so the agent doesn't need to paste the corrected text back
  into chat unless asked.
- **Why**: without the second sentence, agents will keep quoting the
  corrected text as a reply, duplicating what the UI now shows (#12).
- **First chunk**: the whole track.

## Could this be simpler?

Simplest plausible version: skip identity entirely — the event carries only
`{sessionId, newText, originalText}`, and the frontend finds the message by
the same normalized-text matching `reconcilePending` uses
(`machines/chat-shared.ts:94-104`).

What the fuller plan buys, concretely:

- Text matching breaks exactly when the feature matters most: `retranscribe`
  exists for messages whose text is *wrong*, and `--file`/diarized flows
  hand back text that may share little with the bubble. A near-miss match
  would swap text onto the **wrong message** — the one failure mode worse
  than no indicator (principle #4). The emission id is already the identity
  everywhere else (retention key, wire `messageId`); persisting it is one
  attribute in an existing convention, not a new mechanism (#8,
  `feedback_minimal_concepts_prefer_primitives`).
- The attribute also future-proofs the accepted transience: durable overlay
  later needs an id that survives reloads; text matching forecloses it.

A simpler cut that WAS taken: no in-progress indicator. The HQ pass takes
seconds and the issue asks what shows during it; the answer is nothing —
only success reports (Google Recorder's processing-card pattern rejected: a
spinner on the user's own message reads as their message being broken, and a
failed pass then needs an un-spinner path; success-only has no failure UI at
all).

Also deliberately NOT one event with optional fields: two zod-typed events
keep every consumer exhaustive (#1, #2).

## Subplans

None.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Old/foreign tab answers last-audio without `messageId`/`sessionId` | planned (route doctest: absent fields) | headers omitted; CLI skips report | silent by design (today's behavior) |
| `--file` retranscribe (no fetched identity) | planned (CLI-level doctest) | no report attempted | silent by design |
| Report POST fails (server down mid-command, auth) | planned | `console.warn`, command still succeeds; stdout unchanged | warn (agent-visible in tool output) |
| Event arrives for a message not in the rendered window (paged out, other session's tab) | planned (frontend doctest) | overlay entry sits unused; `forSession` filters foreign sessions | silent, harmless |
| Entry still pending when event arrives (uuid = messageId, no wrapper text) | planned (frontend doctest) | resolution falls back to `entry.uuid === messageId`; re-resolves via attribute after the swap | clear (covered both sides of the swap) |
| Retention store evicted the recording (>5 messages ago) | exists today | fetch already answers none; nothing new fires | silent (unchanged) |
| Reload after retranscription | manual-testing note | overlay gone, original text back — accepted decision | deliberate; recorded here and in the issue |
| Report POST succeeds but no tab is subscribed (disconnect during the HQ pass) | no (untestable without heavy harness) | none — transient emit has no ack; indicator silently missed | silent, accepted for a visual-only feature (documented in Vocabulary lock-ins) |
| Two retranscriptions of the same message | planned | last event wins the overlay; popover always shows the ORIGINAL bubble text, not the previous overlay | clear |
| Agent fabricates `message-id` in its own output | no (prompt-level) | prompt forbids; overlay only consults user entries | silent gap, low harm |

**Critical gap:** none — every degradation lands on today's behavior
(stdout-only, no indicator).

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field** — ADDRESSED: agents never write any of this
  vocabulary; Track 4 says ignore/never fabricate.
- **Stale ref** — ADDRESSED: an overlay for an unrendered message idles
  unused (failure-modes table).
- **Two agents touching the same card** — not applicable (no card writes).
- **Hand-edit drift** — not applicable (transcript is SDK-owned).
- **Fabricated free-form value** — ADDRESSED: `newText` comes from the
  transcription service via the CLI; the popover labels it with the
  service; React escaping prevents markup injection.
- **Validation error UX** — ADDRESSED: the report route zod-rejects with a
  400 the CLI warns about; the command still succeeds.
- **Partial migration / transition state** — ADDRESSED: pre-existing
  messages have no `message-id`; retranscribing them yields a fetch with no
  id → no report → today's behavior. No backfill.

## NOT in scope

- **Durable overlay (reload survival)** — accepted-transient per the
  boxholder; the identity attribute keeps the door open (husk machine-owned
  field, `review-span` precedent at `src/schemas/chat.ts:22-27`). Revisit
  only if transience annoys in practice.
- **In-progress indicator** — rejected above (Could this be simpler?).
- **Rewriting the SDK transcript** — append-only, SDK-owned
  (`transcript-sync.ts`); explicitly excluded by the issue.
- **iOS parity** — the native app renders chat through the shared web view,
  so the bubble UI comes for free; native *dictation* messages carry no
  retained audio (no `stt=`, no retention entry) and can't be retranscribed
  today — unchanged.
- **Narration-mode HQ pass indicator** — that path replaces text *before*
  send (`prepareVoiceSubmitEmission`), so the bubble is already correct;
  nothing to indicate.
- **Badging `whats-changed`/screenshot or other consultations** — only the
  three audio commands; "every tool leaves a trace" is a different feature.

## Open design questions

- **Badge glyphs** — something small: a "corrected-text" glyph for
  retranscription, an ear/headphone for consulted. Pick in Track 3 with a
  `bin/browse` look; the boxholder asked for emoticon-scale, not chrome.

## Knowledge audits

No new audit. Rationale: the only agent-facing additions are "ignore
`message-id`" and "don't paste the corrected text back" — both are
single-sentence prompt guidance with no recall-dependent procedure, and the
existing `chat-unsure-word-semantics` audit already exercises the
surrounding retranscribe guidance section. If Track 4's second sentence
proves to need enforcement (agents keep double-posting corrections), add a
`chat_mode` audit then.

## Implementation order

1. **Track 1** — identity thread-through (attribute, multipart fields,
   headers, pending shape) + doctests.
2. **Track 2** — events + report route + CLI call sites + doctests.
   Depends on 1.
3. **Track 3** — frontend handlers, overlay store, badges/popovers +
   doctests + `bin/browse` check. Depends on 2 for payload shapes.
4. **Track 4** — prompt sentences. Independent.
5. Manual-testing note on the issue (real dictation → agent retranscribe →
   swapped text + badge; ask-about-audio → badge; reload → reverts by
   design).

Tracks are serialized (one subagent at a time — same-subproject typecheck
collisions).

## Rollout shape

- **Tests first, per track**: Track 1 extends the pinned assemble doctests
  + a `makeTestServer()` route doctest for the multipart/header round trip;
  Track 2 a route doctest for both event emissions + zod rejection; Track 3
  frontend doctests for resolution (attribute match, pending-uuid fallback,
  foreign-session filter) and render (swap + badge, consulted badge, raw
  attribute never displayed). Done-when = those pass; the human-visible
  end-to-end stays on the issue's manual-testing gate.
- **No migration**: all additions are optional fields and new attributes on
  new messages.
- **Cross-model review** before building (per the standing mandate), and
  again on the implementation diff before the work is called done.
- Ships from this worktree when the boxholder says so.
