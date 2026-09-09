---
title: "pub-worker: pre-auth pub-id status oracle + unbounded any-account access-log writes"
workstream: pub-setup-wrangler
area: beebox
filed-by: agent
discovered-in: worktree-pub-setup-wrangler — Codex cross-review of the pub-setup rework surfaced these as pre-existing Worker behavior, out of that item's scope
---

> `reconfirm?` checked 2026-09-05: both hazards are still in `pub-worker/src/index.ts` — manifest 404/410 checks run before `authenticateAccess`, and the `any-account` tier calls `logAccess` before `serveAsset` validates the path. No fix landed; the decision framed in the body is still open.

Two hardening tensions in `beebox/pub-worker/`, found by an adversarial
review of the publish credential model. Both are pre-existing behavior of the
Track C/D Worker, not regressions.

## 1. Pre-auth requests can distinguish publication states

For `/a/<pub-id>/...`, manifest load and status checks run BEFORE the Access
JWT check (`pub-worker/src/index.ts` — order: manifest 404 / revoked 410 /
expired checks, then authentication 401). A requester who holds or guesses a
pub-id but has NO valid login can therefore tell apart: missing, revoked,
and live publications. `POST /__submit/<pub-id>` has the same shape
(`pub-worker/src/submit.ts`): it reads the manifest, buffers up to 1 MiB of
body, and reveals status distinctions before authenticating; the per-IP rate
limiter is optional and applied later.

Pub-ids are 128-bit random (unguessable), so the oracle only matters for ids
that leaked. Options: authenticate first on `/a/` (uniform 401 before any
manifest read), or accept and document the oracle since revocation/expiry
already tombstone content. Deciding either way should be deliberate.

## 2. `any-account` access-log writes are unbounded

Every Access-verified request to an `any-account` publication writes one
access-log object BEFORE asset-path validation or the asset existence check
(`pub-worker/src/index.ts` — the `logAccess` call; `access-log.ts` swallows
write failures). Any authenticated identity can loop requests for nonexistent
assets on a known pub-id and mint unlimited R2 objects — no dedup, no rate
limit, and the pull connector then lands them all. Options: log only after a
successful asset lookup, per-identity dedup within a window, or reuse the
submit endpoint's rate-limiter binding.
