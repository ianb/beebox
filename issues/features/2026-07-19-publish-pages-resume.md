---
title: "Publish-pages: resume the Cloudflare publishing feature"
area: callback-box
needs: [implementation, manual-testing]
design: ../../callback-box/docs/plans/publish-pages.md
---

Handoff for the external-publishing feature (publish box docs/views to public(ish)
Cloudflare-hosted URLs). Most of it is built and committed on branch
`worktree-publish-pages`; the remaining work needs a live Cloudflare account and is
best finished in a fresh session. Full design + security review:
[publish-pages.md](../../callback-box/docs/plans/publish-pages.md).

## What's done (committed on `worktree-publish-pages`, 11 commits, all tested)

- **Plan** — security-reviewed; account tiers use **Cloudflare Access** (not
  hand-rolled OAuth); two flagged deviations (manifests in **R2 not KV** for strong
  consistency; account-log as **per-entry objects** not `.jsonl`); two accepted-and-
  deferred injection risks (submission→agent prompt injection; shared-origin bundle).
- **Track A** — `src/publish/manifest.ts` + `manifest-edge.ts`: tier-discriminated
  zod unions (illegal states like public+submit unrepresentable), `PubId` (128-bit
  base32), `toEdgeManifest` projection. The edge module is node-free (imported by the
  Worker).
- **Track B** — `src/publish/render-docs.ts`: self-contained docs renderer (Markdoc,
  inline CSS, zero JS, images inlined/content-addressed). **Views renderer is NOT
  done** — it's a subplan (below).
- **Track C** — `pub-worker/`: the Cloudflare Worker serving core. Path/tier parsing,
  R2 manifest safeParse, fail-closed 404/410, **serve-time asset-path traversal
  guard**, full security-header set on every response. 53 vitest-pool-workers tests.
- **Track D** — Worker-side Cloudflare **Access JWT** validation for account tiers
  (RS256 pinned, aud/iss/exp checked, JWKS cached, fail-closed), per-pub allowlist,
  per-view access logging. Tested with a stubbed in-test keypair.
- **Track E (partial)** — `cb pub draft` (render + leak-scan + write + human-gated
  commit), `cb pub ls`, `cb pub revoke`, `cb pub go` (the **human flip**: TTY confirm,
  refuses non-TTY, bundle-first/manifest-last upload). Leak scan in
  `src/publish/leak-scan.ts`. **`cb pub setup` and `cb pub status` are NOT done.**
- **Track F** — submit endpoint (`pub-worker/src/submit.ts`, twice-enforced
  no-public-submit, tier-based submitter identity, size/cap limits) + the pull
  connector (`src/connectors/publish-submissions.ts`, land-then-delete, idempotent) +
  the `pub-submission` untrusted-input card schema. Wired into `wakeup-connectors.ts`.
- **R2 store** — `src/services/publish-remote-store.ts` talks to Cloudflare's **REST
  API with one bearer token** (verified live: object PUT/GET/DELETE/list all work), so
  publishing needs a single credential, not a separate R2 S3 key.

## What remains

1. ~~**`cb pub setup`**~~ DONE (plus `cb pub status`) — merged to `main` in
   `0597b59f` (`feat(publish): cb pub setup + cb pub status behind an
   injectable Cloudflare client (Track E)`, via `worktree-agent-ab7a0f30e32308676`).
   Implemented behind an
   injectable `CloudflareProvisioningClient` (`src/services/cloudflare-provisioning.ts`,
   fake for tests) + an injectable wrangler-deploy runner (`src/publish/setup.ts`);
   status logic in `src/publish/status.ts` with a `/__version` drift probe (the Worker
   now serves `GET /__version` from a deploy-stamped `PUB_WORKER_VERSION` var — the
   hash of the committed Worker source, `src/publish/pub-worker-meta.ts`). Setup
   enforces + read-back-verifies previews-disabled, prints the hostname, and prints
   the manual Access app + Google IdP instructions (re-run with
   `--access-team-domain`/`--access-aud` to bake the vars in). The REAL Cloudflare
   adapter and the real `wrangler deploy` spawn are ⚠️ UNVERIFIED — no live CF call
   has been made; iterate their specifics during the live pass (exact endpoints to
   check: R2 bucket GET/POST, `workers/subdomain`, `workers/scripts/<name>/settings`,
   `workers/scripts/<name>/subdomain` with `previews_enabled`).
2. **End-to-end verification** (plan step 7): `cb pub draft` a doc → `cb pub go` (needs
   a TTY; the human types the pub-id) → fetch the `workers.dev` URL, confirm it serves
   + carries the strict headers → `cb pub revoke` → confirm 410. Then a `secret`-tier
   submission → confirm the connector lands a `pub-submission` card on `cb wakeup`.
3. **Views subplan** — `docs/plans/publish-view-snapshot.subplan.md` (referenced by the
   plan, not yet written): the publish-mode view host, runtime bundling, and the
   p5/figure-CSP question. Extends publishing beyond docs.
4. **Docs + knowledge audits** (plan step 9): `docs/publishing.md`, box-agent guidance,
   and author + **run** the four `knowledge-audits.yaml` entries.

## How to resume (gotchas)

- **Node**: `main` now pins **v24** (`engines: >=24.11.0 <25`, `.nvmrc v24.18.0`) —
  this superseded the v22 pin this feature was originally built against. After
  switching Node versions, `better-sqlite3`'s native binding needs a rebuild
  (`NODE_MODULE_VERSION` mismatch otherwise breaks most of `pnpm test` with
  `ERR_DLOPEN_FAILED`, plus 30s+ hangs from things that depend on it): `cd
  node_modules/better-sqlite3 && npm run build-release`, or reinstall from clean.
- **Credentials (SUPERSEDED 2026-07-31)**: the dotfile below is retired — setup now
  rides `wrangler login`, the connector reads
  `config/connectors/publish.secret.json` (ingestion-bucket-scoped token), and the
  ingestion data moved to a second R2 bucket. See
  [pub-setup-wrangler](../../callback-box/docs/implemented-plans/pub-setup-wrangler.md). The
  original text (for archaeology): lived in `~/.cb-publish.env` (mode 600, outside the repo — machine-
  level like the Google OAuth creds). Holds `CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID`. Still needs `CLOUDFLARE_R2_BUCKET` added once a bucket name
  is chosen in setup. Source it with
  `set -a; . ~/.cb-publish.env; set +a`. **One-token REST model** — no separate R2 S3
  token needed. NOTE: the token was pasted into an earlier chat, so **rotate it** once
  the feature is proven.
- **The human-flip is intentional**: `cb pub go` refuses a non-TTY stdin and never
  auto-flips. For an end-to-end test the human runs `go` and types the pub-id; automated
  tests inject a confirm stub. Don't "fix" this by adding a `--yes` that the agent can use.

## Open security decision (not yet made)

**Least-privilege R2 token.** The single management token (Workers Scripts:Edit +
R2:Edit) is used by everything, including the connector that runs every `cb wakeup`. A
box compromise would then hand an attacker a token that can **redeploy the pub Worker**
(take over the public surface), not just read/write R2 objects. A scoped R2-only token
for the connector (with the broad token reserved for one-time `cb pub setup`) is the
hardening — at the cost of a second credential. Deferred for v1 simplicity; the Worker
being versioned in git + the `cb pub status` drift check bound the risk. Decide before
this goes anywhere beyond the boxholder's own account.
