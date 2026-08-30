---
title: "capture-session cards never record the transcription-failed flag their schema documents"
workstream: honest-diagnostics
area: beebox
filed-by: agent
discovered-in: worktree-user-stories-refresh — user-story catalog verification
priority: important
resolution: implemented
---

**What is wrong.** The capture pipeline computes `transcriptionFailed` and puts it on the delivered chat message, but never writes it onto the capture-session card. `src/core/capture/prepare.ts:230` derives `transcriptionFailed = transcription.transcribed < transcription.total` and passes it to `buildCaptureWrapper` (line 281), which encodes `transcription-failed="1"` (`src/shared/delivered-user-message.ts:219`). The card writer runs earlier and knows nothing about it: `writeCaptureDocument` is called at prepare step b (line 208), before transcription at step c (line 226), and `createCaptureSessionTemplate` is passed only `partial` (`src/core/capture/write-cards.ts:253-262`). Step d's `assembleCaptureTimeline` rewrites the body and re-emits the frontmatter verbatim, so nothing backfills the field later.

Meanwhile two schemas promise the field exists. `src/schemas/capture-session.tsx` declares `"transcription-failed": z.boolean().optional()` twice (lines 67 and 112) and documents it in the agent-facing instructions (line 88): "one or more clips still need transcription (the transcription provider was unavailable when this was prepared)." `src/schemas/audio.tsx:60-72` sends the agent to it by name: when an audio card is `status: new` with no transcript, "This usually means the transcription provider was unavailable when the capture was prepared (see the parent capture-session card's `transcription-failed:` flag)."

**User-visible consequence.** The failure signal lives only on the chat message. An agent doing its annotate-and-file pass on a capture card — often in a later session, and for cards that reach the box outside chat, with no `<capture>` message to read at all — follows the audio schema's instruction, finds no flag on the parent card, and has nothing distinguishing "the provider was down" from "this clip is silent / already handled." The boxholder sees audio cards stuck at `status: new` with no recorded reason, and the retry the audio schema describes (`bbx chat retranscribe --file …`) is never prompted for. Once the chip scrolls out of the transcript, the box holds no record that transcription failed.

**Files involved.** `beebox/src/core/capture/prepare.ts` (steps b/c ordering, line 230), `beebox/src/core/capture/write-cards.ts` (line 261, the only frontmatter flag written), `beebox/src/core/capture/timeline.ts` (body-only rewrite), `beebox/src/schemas/capture-session.tsx` (lines 67/88/112), `beebox/src/schemas/audio.tsx` (line 68).

**How this was established.** Read the prepare pipeline end to end and the card writer it calls; then grepped the whole repo for `transcription-failed`/`transcriptionFailed` — every hit is the schema declarations and instructions, the session prompt, the wrapper encode/parse, `CaptureChip.tsx`, the dev harness, docs, and doctests. No writer, no CLI, no migration touches the capture-session frontmatter after transcription runs.

## Updating the user-story catalog

This issue is why [`capture/a-capture-still-arrives-when-transcription-is-down`](../../../../beebox/user-stories/catalog/2026-08-21.md#flagged-worth-a-human-glance) is currently
flagged ❌ in [the user-story catalog](../../../../beebox/user-stories/catalog/2026-08-21.md) — a catalogue of what beebox can
actually do, where every claim is checked against the source.

**When you fix this, re-check that story so the catalog stops being wrong.** It is a
short agent run over just the affected stories, not the full regeneration:

```
Workflow({scriptPath: "beebox/user-stories/pipeline/recheck.workflow.mjs",
          args: {root: "<repo root>", date: "2026-08-21",
                 ids: ["capture/a-capture-still-arrives-when-transcription-is-down"]}})

pnpm exec tsx beebox/user-stories/pipeline/apply-recheck.ts 2026-08-21
pnpm exec tsx beebox/user-stories/pipeline/render.ts \
  > beebox/user-stories/catalog/2026-08-21.md
```

The recheck is adversarial by design: it will not mark the story accurate just because
this issue was closed — it re-reads the code. If it still refutes, that is worth knowing
before you call the fix done. Details in
[the pipeline README](../../../beebox/user-stories/README.md).
