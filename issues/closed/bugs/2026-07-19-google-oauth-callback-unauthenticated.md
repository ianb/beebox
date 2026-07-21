---
title: "Google connector OAuth callback saves centralized tokens without an auth/owner/nonce check"
filed-by: agent
discovered-in: worktree-local-password-auth — Codex adversarial review of the always-on-auth branch (finding #2, pre-existing)
area: callback-box
resolution: implemented
---

**Closed (implemented).** Fixed by requiring a one-time, server-minted `state`
nonce on the connector OAuth callback: `googleSetup` (owner-gated) mints and
persists the nonce (`src/connectors/google-oauth-state.ts`), and the callback
(`src/webapp/routes/admin.ts`) verifies-and-consumes it before exchanging any
`code` — a caller who never passed the owner wall has no valid nonce, so no
token write happens. Nonce is one-time (replay-safe) and short-lived; the
`returnPath` and initiating owner now travel in the stored record, not the URL.
See the commit adding `google-oauth-state.ts` plus its doctests
(`test/connectors/google-oauth-state.doctest.md`,
`test/webapp/routes/routes-google-oauth-callback.doctest.md`).

Surfaced by a cross-model (Codex) security review of the local-password-auth
branch; **pre-existing**, not introduced by that work, so it was filed rather
than folded into that branch.

The Google connector's OAuth redirect callback (`src/webapp/routes/admin.ts`
around lines 24 and 60) accepts a caller-controlled `state`, exchanges the
authorization `code`, and writes the centralized Google refresh/access tokens
(`CB_GOOGLE_TOKENS_FILE`, shared across all boxes) **without** verifying a
session, the owner identity, or a server-generated nonce bound to the initiating
request. An attacker who can reach the callback URL and drive an OAuth code
through it could replace the box's stored Google credentials (a credential-swap
/ token-fixation surface), and the endpoint sits outside the per-box auth wall.

This is distinct from the user-login `/auth/callback` (Google *login*), which
verifies the ID token — this is the *connector* authorization flow that persists
service tokens.

Fix direction (needs design): generate and store a one-time `state` nonce when
initiating the connector OAuth flow (owner-initiated, behind the auth wall) and
require the callback's `state` to match it, plus confirm the request is the
owner. Relates to `docs/todo-security.md` ("shared Google token with broad
scopes"). Verify current behavior at the run layer before assuming exploitability
(the callback may already be unreachable in some deploys).

## Research (incomplete)
