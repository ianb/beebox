---
title: "Publish-pages: resume the Cloudflare publishing feature"
area: callback-box
needs: [implementation]
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

1. **`cb pub setup`** (the one blocker to a usable feature). Provision against live CF:
   create the R2 bucket (`POST /accounts/<id>/r2/buckets`, idempotent — OK if exists),
   deploy `pub-worker` via **wrangler** with the account creds + the `PUB_STORE` R2
   binding + set the `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` vars, **disable preview URLs**
   (old Worker versions are a leak surface — plan Prior-art), print the `workers.dev`
   hostname. Structure the CF calls behind an injectable client (fake for tests) like
   the R2 store; unit-test the logic, iterate the wrangler/CF specifics against live CF.
   For account tiers, setup also needs a **one-time Cloudflare Access app + Google IdP**
   (Zero Trust) — can be manual/instructed first, automated later.
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

- **Node**: the project pins **v22** (`engines: >=22.11.0 <23`, `.nvmrc v22.22.1`).
  Switching to v24 breaks commits/tests (`env: node not found` from tap, engines block
  in husky). `nvm use 22` (or `nvm install 22.22.1`) before working.
- **Credentials**: live in `~/.cb-publish.env` (mode 600, outside the repo — machine-
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
