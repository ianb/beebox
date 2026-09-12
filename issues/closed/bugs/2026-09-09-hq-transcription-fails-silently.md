---
title: "A failing HQ transcription pass is silent — the client logs a console warning and falls back, so a misconfigured HQ service looks like a feature that does nothing"
workstream: openrouter-services
resolution: implemented
area: beebox
priority: important
labels: [transcription, error-reporting, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "I tried it with Voxtral, then switched it to the MAI transcriber… It just doesn't do the hq transcription at all...?"
---

> **Closed 2026-09-11.** All three items are done. Item 1 (visible, persistent
> failure notice) shipped in `hq-recording-resilience` and, after a merge
> conflict, now lives entirely in `main`'s `resilient-voice-recording` Track 4
> (`lib/audio/hq-failure-notices.ts`, `VoiceNotices.tsx`) rather than this
> branch's superseded client half. Items 2 and 3 (disable an unreachable
> service in the picker with its reason; save an unusable choice only with a
> warning) ship in `secret-entry-guidance` (commit `3b51e8f3c`,
> `core/model-capabilities.ts`, `voice.capabilities`, `unusableWarning` on
> `setHqService`/`setBackend`). See `beebox/docs/secrets.md#picking-a-service-the-box-cannot-reach-yet`.

A box was set to `hqService: "mai-diarized"` without the `openrouter` secret
granted to it. Every checkpoint HQ pass then failed, and the boxholder saw no
sign of it — the dictation simply stayed at realtime quality, with nothing to
suggest the configured service was unreachable.

The server does its part correctly. `dispatchHqTranscription`
(`beebox/src/core/transcription/index.ts`) throws `MissingOpenRouterKeyError`,
which is `permanent: true`, carries `code: "missing_openrouter_key"`, and says
in plain words that MAI-Transcribe-2 is reachable no other way and the
`openrouter` secret must be granted. `POST /api/chat/transcribe-audio` returns
that message as a 500 — confirmed in the access log, two 500s on the box's
chat session while a Voxtral pass in between returned 200.

Then it dies. `postAudioForHqTranscription`
(`beebox/src/frontend/src/api-chat.ts`) does:

```ts
if (!res.ok) {
  console.warn(`[hq-transcribe] HTTP ${res.status}: ${await res.text()}`);
  return null;
}
```

`null` means "fall back to the realtime transcript," which is the right
behavior for a flaky network call and the wrong behavior for a permanent
misconfiguration. The message the server took care to write reaches only the
browser console.

## What to change

- **Surface a permanent HQ failure once, visibly.** The error already
  distinguishes itself: `permanent: true` and a stable `code`. Pass the code
  through the HTTP body, and let the client show a persistent notice (the voice
  chip is the natural home) rather than a toast per segment.
- **Keep the fallback.** Falling back to realtime text is correct; the bug is
  that it is indistinguishable from success.
- **Consider refusing the setting at write time.** Selecting an HQ service the
  box has no credential for could warn in the picker — the check is the same
  one `health-model-routes.ts` already performs.

## Two bugs, not one (2026-09-09)

Boxholder: "Even being able to select the model without the key is wrong."

The silent fallback is one failure; offering a choice that cannot work is the
one before it. A picker that lists `mai` / `mai-diarized` on a box with no
`openrouter` grant is inviting a setting whose only possible outcome is a 500
on every pass. Nothing about the credential state is hidden or expensive to
check — `health-model-routes.ts` already resolves exactly this, and the secret
store answers "is `openrouter` granted to this box" directly.

These are two independent bugs, and neither substitutes for the other.

**The silent failure is the more serious of the two.** A picker that offers an
impossible choice wastes a setting; a pass that fails without saying so
destroys the boxholder's ability to tell working from broken. It took a log
dig on the server to establish that the HQ pass had been firing and 500ing all
along — from the chat, the two states are identical. That is true whatever the
picker does: a credential can be revoked, a provider can go down, a key can hit
its limit, and every one of those futures runs through this same silent
`return null`.

So all three of these get fixed:

1. **Report a permanent HQ failure, visibly and once.** The error already
   carries `permanent: true` and a stable `code`; pass the code through the
   HTTP body and show a persistent notice on the voice chip. Keep the fallback
   to realtime text — the bug is that the fallback is indistinguishable from
   success, not that it happens.
2. **Don't offer what can't run.** In the HQ service picker, a service whose
   credential the box lacks is disabled with the reason attached and a link to
   the grant — not silently absent, because "where did MAI go?" is its own
   confusion. The system already knows: `health-model-routes.ts` resolves
   exactly this, and the secret store answers "is `openrouter` granted to this
   box" directly. Same shape as the secrets-UI problem (see
   [secrets add form hides the names that work](../features/2026-09-09-secrets-add-form-hides-the-names-that-work.md)).
3. **Refuse to save an unusable setting**, or save it with a warning the
   boxholder has to acknowledge. A config naming a service the box cannot reach
   should never be written quietly.

## Partial fix (2026-09-10, `hq-recording-resilience`)

Item 1 only. A permanent HQ failure now surfaces visibly: the voice chip shows
a failure notice, and a chat voice send that falls back to realtime text is
stamped `hq="failed"` rather than looking indistinguishable from a normal HQ
send (`beebox/src/frontend/src/lib/audio/hq-failure-notices.ts`,
`beebox/src/frontend/src/input/emission.ts`). Items 2 and 3 — disabling an
unusable service in the picker, and refusing to save one — are untouched.
Left open for them.
