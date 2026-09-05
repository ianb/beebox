---
title: "Close the secret-store transition window: remove legacy file/env fallbacks"
workstream: secret-custody
area: beebox
labels: [security, secrets]
filed-by: agent
discovered-by: Ian
discovered-in: worktree-secret-custody — after running the data migration on dev + prod
priority: important
---

The secret store shipped 2026-08-17
(`beebox/docs/implemented-plans/secret-custody.md`) and the data
migration ran the same day on the dev machine and prod. By design, all
legacy paths were left working as fallbacks for a soak period. This issue is
the deliberate closing pass — remove them once the store has proven itself
in normal operation.

## Preconditions (the soak)

- Several days of normal wakeups with the access log
  (`~/.config/beebox/secrets-log/`) showing store resolutions for the migrated
  names on both machines, and no `legacy fallback` deprecation warnings in
  service logs.
- No box flagged unhealthy for secret reasons (`bbx secrets status <box>`,
  `bbx health`).

## What to remove (code)

- **Legacy per-box file fallback** in the nine migrated readers — the
  `refusalAllowsLegacyFallback` path (`src/core/secrets/legacy-fallback.ts`)
  and each reader's file-read branch. After this, `unknown-secret` no longer
  falls through; `bbx health`'s stray-file flag becomes the only mention of
  `config/connectors/*.secret.json`.
- **Env-var credential fallbacks** in the same readers
  (`BBX_MISTRAL_API_KEY`, `BBX_DEEPGRAM_*`,
  `THINKING_OPENAI_API_KEY`, `GEMINI_KEY`/`SKE_GEMINI_API_KEY`,
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`).
- **Connector entries in the env allowlists** — the tooling profile in
  `src/core/script-env-allowlist.ts` and the hub child allowlist in
  `src/hub/child-env.ts` drop every connector-credential name/prefix. This
  also closes the documented scheduled-script residual (arbitrary `runs:`
  commands currently inherit transition-window connector env — recorded in
  the Track 1 commit and the implemented plan's rollout note).
- **`deploy/add-box.sh`'s legacy copy branch** (fires only when the source
  box has no grants and still has files).

## What to remove (data, per machine)

- Delete the migrated `config/connectors/*.secret.json` files (NOT the
  box-local ones the migrator skipped: `capture`, `dropbox`, `raindrop`,
  `kie`, `omdb`, `tmdb`, nor google/gmail token files — those are outside
  the store's scope today).
- Strip the credential lines from `/home/beebox/.env`
  (`THINKING_OPENAI_API_KEY`, `GEMINI_KEY`, `BBX_DEEPGRAM_*`,
  `GOOGLE_OAUTH_CLIENT_ID/SECRET`) — keep the non-credential config
  (`PUBLIC_URL`, `BBX_OWNER_EMAIL`, `BBX_GOOGLE_TOKENS_FILE`,
  `BBX_DIAG_API_KEY` stays: hub-trust, not a connector secret). Restart the
  units after.
- Keep the store backups in `~/.config/beebox/backups/` until this pass is
  verified, then they can be pruned.
- **Dev machine (found 2026-08-19):** the shell profile exports
  `BBX_MISTRAL_API_KEY`, `THINKING_OPENAI_API_KEY`, and
  `GEMINI_KEY`/`SKE_GEMINI_API_KEY` — now also in the local store (set +
  granted 2026-08-19, probes ok), so these profile lines can be removed in
  the same pass. The `SKE_*`/AssemblyAI exports are other projects', not
  beebox readers — leave them. Also stale: `~/.beebox-publish.env`
  (retired 2026-07-31 by the wrangler-login publishing setup) still exists
  on disk and can be deleted.

## Verify after

- Full doctest suite; a real wakeup on a prod box with transcription; the
  plan's done-when greps (`*.secret.json` absent from box trees; no
  box-tree readers in `src/` outside the health flagger).

Related still-open items this does NOT cover: the chat capture widget
([write-only-secret-capture-in-chat](../features/2026-07-19-write-only-secret-capture-in-chat.md)),
the box-local connectors above (candidates for `agent`-access grants
eventually), and the replicate `api_token`-vs-`apiKey` mismatch (adapter
was never configured; enable deliberately via `bbx secrets set replicate`
if wanted).
