---
title: "Per-user Google OAuth tokens"
workstream: unknown
area: beebox
priority: backlog
---

Currently Google connector tokens are stored per-box in a single `google.secret.json`. Any box user should be able to connect their own Google account. This means per-user token storage (e.g., keyed by email), knowing which user's tokens to use for which operations, and the OAuth callback tracking which user initiated the flow.

## Audit 2026-10-22

The storage claim drifted. Tokens now live in one server-wide file named by `BBX_GOOGLE_TOKENS_FILE`, with the per-box `google.secret.json` kept as a legacy fallback (`beebox/src/google/token-store.ts:1-10`, `:100-135`). One refresh token still serves every user and every box on the server. No per-user keying exists, so the request stands.

Re-reviewed 2026-10-30: since per-box units, a unit host stores the token per box user (~/.config/beebox/google-tokens.json); the env-var file is still shared. Still no per-person tokens.

Out of date in the body above: In the 2026-10-22 audit, replace 'One refresh token still serves every user and every box on the server' with: one refresh token per box on a unit host (box user's ~/.config/beebox/google-tokens.json), or one shared across boxes when BBX_GOOGLE_TOKENS_FILE is set; never per person.
