---
title: "A failing HQ transcription pass is silent — the client logs a console warning and falls back, so a misconfigured HQ service looks like a feature that does nothing"
workstream: unattached
area: beebox
priority: important
labels: [transcription, error-reporting, chat]
filed-by: agent
discovered-by: Ian
discovered-in: main session — "I tried it with Voxtral, then switched it to the MAI transcriber… It just doesn't do the hq transcription at all...?"
---

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

## Selecting an unreachable service is the deeper bug (2026-09-09)

Boxholder: "Even being able to select the model without the key is wrong."

The silent fallback is one failure; offering a choice that cannot work is the
one before it. A picker that lists `mai` / `mai-diarized` on a box with no
`openrouter` grant is inviting a setting whose only possible outcome is a 500
on every pass. Nothing about the credential state is hidden or expensive to
check — `health-model-routes.ts` already resolves exactly this, and the secret
store answers "is `openrouter` granted to this box" directly.

So the fix has three parts, in order of importance:

1. **Don't offer what can't run.** In the HQ service picker, a service whose
   credential the box lacks is disabled, with the reason attached and a link to
   the grant — not silently absent, because "where did MAI go?" is its own
   confusion. This is the same shape as the secrets-UI problem: the system
   knows, and doesn't say (see
   [secrets add form hides the names that work](../features/2026-09-09-secrets-add-form-hides-the-names-that-work.md)).
2. **Refuse to save an unusable setting**, or save it with an explicit warning
   the boxholder has to see. A config file naming a service the box cannot
   reach should never be written quietly.
3. **Then** make the runtime failure visible, per the section above — because
   a credential can be revoked after the setting was valid, so the runtime path
   still needs an honest error even once the picker is fixed.
