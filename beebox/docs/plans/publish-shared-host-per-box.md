---
title: "Serve box publications from one shared hostname"
status: partial
workstream: publish-pages
issues: []
---
# Serve box publications from one shared hostname

When a box publishes several sites, it should serve them as paths on one Admin-configured hostname. The shared Worker uses the box's existing publishing connection and content bucket. New publications keep member approval, and existing per-publication Workers and URLs continue to work.

**Issues addressed:** none found in `issues/` for shared-host publication routing. This supersedes the [per-publication custom-domain plan](../unimplemented-plans/publish-custom-domain-admin.md); existing Worker bindings and URL compatibility remain, but its setup UI/API are removed. No live Cloudflare hostname or DNS changes are part of this work.

## Smallest fix and budget

The smallest complete change adds one shared Worker per box, configured with that box's existing content bucket, and routes public paths through slug objects and secret paths through their PubIds. Admin assigns one hostname to one selected Cloudflare connection granted to that box, provisions the shared Worker and bucket even before the first publication, and attaches the hostname once. Public paths use `/<slug>/`; secret paths use `/s/<PubId>/`. New publications use this Worker and do not deploy a pinned Worker per PubId. Publication candidates bind the shared hostname and path; a signed-in member approves that destination before it becomes available through the shared Worker. Existing per-publication workers.dev URLs remain active and keep their current manifests and gates. The shared Worker's workers.dev and preview routes remain disabled.

Estimated changed lines: 850–1,200 source lines, 400–600 test lines, and 150–250 documentation lines (1,400–2,050 total). **BIG CHANGE; approved by the boxholder on 2026-09-26.** The largest variables are Admin setup before any publication exists, safe shared-Worker deployment, and preserving per-publication Workers after existing manifests are refreshed. Generated output is separate. Actual implementation diff at review: 2,832 changed lines before the plan/archive artifacts, counted as additions plus deletions against the base: 1,632 source, 566 tests, and 634 documentation plus knowledge-audit lines. This exceeds the estimate because the change removes superseded per-publication setup code and replaces operator, box-agent, security, and audit guidance as well as adding new paths and tests. The implementation remains within the boxholder-approved shared-host scope; no additional product surface was added.

**Implementation status (2026-09-26):** The shared-host implementation and selected code checks are complete. Worker tests pass (73); selected managed-publication tests pass (19/19), Cloudflare host/provisioning tests pass (5/5), and CLI tests pass (19/19). Typechecks, lint, documentation checks, and commit hooks pass. The two new box-agent knowledge audits remain unverified: the Codex runner exited before the prompt with `No such file or directory (os error 2)`, and the bundled Claude binary failed to launch before prompt execution. No agent knowledge result is claimed. No real Cloudflare hostname, DNS, token, or account-permission test was performed; browser inspection showed only the Admin query-error/empty state, not a fully working setup flow. This plan remains partial until the knowledge audit can run; live Cloudflare setup remains a separate operator action.

## Stated preferences this plan trades against

- **Preserve member control of a public destination.** The publication plan requires a signed-in member to approve before content becomes live (`beebox/docs/plans/publish-sites-admin.md:10,68`). The shared hostname and public or secret path are part of the candidate revision and approved manifest. Admin configures the shared destination; the box agent cannot change it.
- **Keep one box sharing granularity.** The identity design says a box has one granularity of sharing (`beebox/docs/design/identity.md:31-36`). This plan therefore gives each box one shared origin; it does not route multiple boxes through one origin or introduce new per-publication origin isolation.
- **Validate at boundaries.** Manifests, candidate destinations, slug pointers, and hostname configuration remain strict and fail closed (`beebox/docs/engineering-principles.md:37-47`). A shared Worker must verify that a route resolves to a manifest whose approved path matches the request.
- **Keep changes narrow.** `beebox/CLAUDE.md` says to work only on the requested problem. New publications use the shared hostname; old per-publication URLs remain compatible, while old Cloudflare attachments are never automatically removed.

## What already exists

- Admin-managed Cloudflare connections are granted to boxes and credentials stay server-side (`beebox/src/core/secrets/cloudflare-publish.ts:90-151`). Reuse that grant and connection for the box hostname mapping.
- A box and connection already share an R2 content bucket across publication bindings (`beebox/src/core/secrets/cloudflare-publish.ts:225-230`). Each publication's data is namespaced under `pubs/<PubId>/...` (`beebox/src/publish/managed-publications.ts:77-82 (moved to `beebox/src/publish/managed-publications/core.ts`), 96-102`). Reuse this bucket; do not provision a connection-wide or cross-box content store.
- Managed publication candidates include a strict tier scope and hash it into a revision (`beebox/src/publish/managed-publications.ts:28-52 (moved to `beebox/src/publish/managed-publications/core.ts`), 54-72`). Extend that server-derived candidate scope with the requested shared hostname and route path. Keep the old strict serving manifest shape unchanged so an existing pinned Worker does not reject it.
- The edge manifest is strict, and the current per-publication Worker pins a single `PUB_ID` and `HOST_HANDLE` (`beebox/src/publish/manifest-edge.ts:157-193`; `beebox/pub-worker/src/site.ts:15-59`). Add an explicit shared-host mode/version rather than interpreting old pinned manifests as shared-host manifests.
- The Worker already resolves legacy public slugs through `slugs/<slug>` and secret routes from `/s/<PubId>` (`beebox/pub-worker/src/index.ts:200-211` (moved to `beebox/pub-worker/src/worker.ts`)). Managed sites currently serve one pinned manifest and do not write those public slug pointers; shared hosting must maintain them as approved path indexes. For the shared host, reserve `/s`, `/p`, `/a`, and Worker-owned `__*` routes so a public slug cannot shadow them.
- Member approval checks candidate revision and server-owned binding before writing the manifest (`beebox/src/publish/managed-publication-actions.ts:9-27, 44-48`). Extend those checks to the shared hostname and current path assignment.
- Current per-publication URLs are constructed in the Publications page (`beebox/src/frontend/src/pages/PublicationsPage.tsx:97-115`). Make the shared-host URL the new publication's primary link. Keep old `workers.dev` aliases visible for legacy pinned Workers when they still apply; the shared Worker's own `workers.dev` and preview routes are disabled.
- The current hostname Admin component contains an uncommitted empty-state improvement in this checkout. Preserve its relevant explanation when replacing the per-publication assignment UI.

## Prior art (external)

- Cloudflare Custom Domains route every path on an exact hostname to the attached Worker and require an active zone. This supports one shared Worker as the origin for publication paths: [Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
- Cloudflare's API uses a success envelope that can fail independently of HTTP status. The current adapter parses `success` and `errors`, but its unsuccessful-envelope error drops the provider `errors[]`; the fix should retain only validated, bounded provider diagnostics and must not claim to explain any real account failure without its response: [Cloudflare API response structure](https://developers.cloudflare.com/fundamentals/api/response-codes/).

## Ontology

- **Box shared-host mapping** (new, machine-owned): the one exact hostname and Cloudflare connection configured for a box; it is not a publication, access tier, or cross-box host namespace.
- **Shared-host Worker** (new deployment mode): one Worker bound to the box's existing content bucket and configured hostname; it routes only publications stored in that bucket.
- **Publication route** (existing public slug or secret PubId, newly served through the shared Worker): the path that identifies one approved publication; public paths use `/<slug>/`, secret paths use `/s/<PubId>/`.
- **Requested shared destination** (new candidate scope): the machine-derived hostname and route, included in the candidate revision; it is not agent-authored.
- **Approved shared route marker** (new R2 sidecar object keyed by PubId): records the approved shared hostname and route for this publication; it is not the authority for live status, tier, slug, release, or audience, and it is not a publication listing.
- **Legacy publication Worker** (existing): the Worker pinned to one PubId. It remains in place for existing URLs and manifests during this transition.

## Tracks / scope

### Track A — Versioned shared Worker routing

**What:** Add a shared-host serving mode to `pub-worker` and bind it to the box-and-connection bucket.

**Why this needs to change:** Existing site mode reads one pinned PubId (`beebox/pub-worker/src/site.ts:54-63`). A shared hostname must resolve many public and secret paths while enforcing each publication's manifest status, approved scope, expiry, and existing response headers.

**Direction:** Give the Worker an explicit mode/version binding, shared hostname, and box host handle. In shared mode, reject requests whose `Host` does not match the configured hostname; `workers.dev` and preview routes stay disabled. Resolve `/<slug>/...` through `slugs/<slug>` and `/s/<PubId>/...` directly. Load and validate the existing strict site manifest; require the approved route marker to match host and path, then require live status, expected host handle, public tier, and exact equality between manifest slug and requested slug before serving. For secret paths, require secret tier and exact PubId path; the PubId remains the unguessable capability. The Worker returns no publication listing or discovery endpoint. Preserve old Worker behavior when the new mode binding is absent. Reserve `/s`, `/p`, `/a`, Worker-owned `__*` paths, and reserved file endpoints from public slugs. Serve the active release directly under stable `/<slug>/` and `/s/<PubId>/` paths; reject release-qualified request paths. Published assets must use relative URLs or the publication's explicit path prefix; do not add a general HTML or JavaScript rewrite. Add no permissive CORS headers; all response headers continue through the current security-header wrapper. Do not imply that CORS isolates mutually trusted publications on one origin.

**Vocabulary lock-ins:** Shared Worker mode is distinct from the existing PubId-pinned mode. Route authorization comes from the approved per-publication manifest, not an Admin listing or a path pointer alone.

**First implementation chunk:** Add pure route-resolution and manifest-authorization tests for public slug, private PubId, malformed/stale pointer, wrong tier, disabled/revoked state, unknown route, and legacy mode preservation. No open questions remain in this chunk.

### Track B — Per-box hostname mapping and Worker setup

**What:** Add one owner-managed hostname mapping per box using the existing Cloudflare connection grant and bucket.

**Why this needs to change:** The current Admin operation reserves one hostname against one PubId and attaches it to that PubId's Worker (`beebox/src/publish/managed-publication-custom-domain.ts:43-58, 100-131`). The requested model configures a shared destination for the whole box.

**Direction:** Store an immutable mapping keyed by `boxSlug` containing one `connectionName`, hostname, bucket name, shared Worker name, host handle, and `pending`/`attached` state. Admin owner RPC requires that box's existing server grant for the selected connection. Reuse that connection's existing per-box bucket when present; for a fresh box, allocate it through the existing provisioning primitive. Before provider writes, reserve the pending mapping. Admin setup deploys the explicitly identified shared Worker and attaches the hostname before any publication exists. Verify script/account/bucket/mode bindings and exact hostname/service/zone identity. Mark the mapping attached only after exact provider readback; retries accept only the same known assignment. A pending mapping blocks publication preparation until retried. No automatic detach, delete, reattach, rename, or connection switch is allowed. New publications use this mapping and do not deploy a pinned per-PubId Worker. Existing per-publication bindings and hostname reservations remain unchanged. Other connections already granted to the box remain usable for old publications, but their publications are not silently routed through this selected shared host. The shared Worker's workers.dev and preview routes stay disabled. The domain API currently drops structured `errors[]` only on unsuccessful envelopes; preserve bounded validated provider code/message where present without returning raw bodies or credentials.

**Vocabulary lock-ins:** One hostname per box; one connection selected for that hostname; no connection-wide router spanning boxes. Existing per-publication custom-host assignments remain legacy aliases only.

**First implementation chunk:** Add machine-store mapping operations, Admin owner-only assignment and readback, and fake-backed coverage for missing grants, other-service conflict, repeat assignment, and provider error envelopes. No Cloudflare or DNS mutation is performed as implementation validation.

### Track C — Candidate approval and per-publication paths

**What:** Bind the shared hostname and route into prepared candidates, member approval, and managed manifest updates.

**Why this needs to change:** Candidate scope currently records the tier and slug, while the custom hostname is a per-PubId binding (`beebox/src/publish/managed-publications.ts:28-72` (moved to `beebox/src/publish/managed-publications/core.ts`)). Every publication served by the shared Worker needs a destination the member explicitly approved.

**Direction:** New candidate scope includes the server-derived shared hostname and resolved route. Public routes require an explicit slug; give an actionable prepare error with an example instead of inventing a slug. Include hostname and route in the candidate revision, but keep the existing serving manifest schema unchanged so an old pinned Worker continues serving it after refresh. On approve, verify the current box mapping still matches the candidate. Acquire locks in one order everywhere: the box's shared-routing lock, then the per-PubId lock. Write and read back the approved existing manifest, then a PubId-keyed route marker containing the exact hostname and path. For public routes, also write and read back `slugs/<slug>` as the lookup index; for secret routes, the PubId-keyed marker is the enrollment gate. The Worker requires the marker to match the configured hostname and requested path, then checks the current manifest's live status, tier, PubId, host handle, and slug on every request. The marker grants no authority over live status, release, or audience. Thus stale or merely preexisting live manifests are not automatically admitted to the shared host. If a public slug changes, write and confirm the new marker and pointer. Keep the old pointer as an inert lookup index: it cannot pass the marker and manifest checks after the manifest changes, and another publication may reclaim the slug. Disable leaves the marker and pointer in place; the manifest's disabled status remains the authority and makes the request unavailable. Revoke leaves a fail-closed tombstone. A same-connection legacy publication enters the shared host only after prepare and member approval. A public legacy publication without a slug remains on its pinned Worker until the owner explicitly opts into the shared host with a slug. Refresh uses the current mapping and the exact existing marker to recognize already-approved scope; a missing or changed marker requires member approval. Keep secret paths private and direct; never list them. Account-gated tiers remain blocked.

**Vocabulary lock-ins:** Shared routing mode is a Worker deployment binding, not a new per-publication manifest version. Candidate requested scope has the shared hostname and route; the PubId-keyed route marker stores that approved destination. The existing strict serving manifest continues to carry authoritative tier, slug, status, release, and optional legacy `customHostname`. The Worker mode distinguishes old per-publication manifests from shared routing. This lets an old pinned Worker keep parsing refreshed manifests without a deployment upgrade.

**First implementation chunk:** Add prepare/approve/enable/update tests for approved hostname/path binding, mapping changes during review, public slug collision, stale slug pointer, secret URL enrollment, shared-marker/manifest disagreement, root-relative asset handling, active content at the public and secret stable paths, plus rejection of release-qualified request paths, and unchanged legacy custom-hostname alias. Ensure pending paths are not discoverable before approval and the marker cannot override a disabled/revoked/wrong-tier manifest.

### Track D — Admin and member-facing destinations

**What:** Replace per-publication custom-host setup for new work with a per-box hostname mapping; show approved paths and links in Publications.

**Why this needs to change:** The existing UI selects one prepared publication for each custom hostname (`beebox/src/frontend/src/components/admin/CustomHostnameAssignment.tsx`). New setup should map one hostname to a box and let member-reviewed publication candidates select paths below that host.

**Direction:** Keep connection custody and grant management in Admin. Add a per-box hostname assignment control that says all paths on the hostname will route to this box's shared Worker. Publications lists only publications already known to the member; it does not expose a private-site directory. Show the requested host/path before approval and the approved shared URL after approval, based on the active manifest and approved route marker even when another candidate is pending. Preserve and adapt the current empty-state guidance. Keep old per-publication `workers.dev` links visible as compatibility aliases when those pinned Workers remain; do not expose the shared Worker's `workers.dev` or preview endpoints; those routes remain disabled. Use standard browser same-origin behavior for publications on that box; do not claim CORS provides isolation.

**Vocabulary lock-ins:** Admin configures the box host; the member approves each publication path. The two actions do not grant each other authority.

**First implementation chunk:** Add owner-only mapping controls and member destination labels/links with UI coverage for no mapping, mapping present, pending candidate, approved destination, and legacy alias.

## Could this be simpler?

Keep one Worker per publication and attach a different hostname to every publication. This already works, but preserves per-publication hostname setup and does not provide shared publication paths; it is the exact design the user rejected. One shared Worker per box plus the existing shared box bucket buys the requested shared origin without a cross-box directory or a new content store, consistent with the user's one-hostname-per-box decision.

## Subplans

None. The user has selected one hostname per box. Account-tier authentication and cross-box routing are explicitly excluded.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| A stale slug pointer identifies a publication whose approved slug changed | Planned shared Worker route doctest | Require the manifest's approved slug to match the requested slug before serving; leave the old pointer inert; the manifest slug check prevents serving it and allows another publication to reclaim it | Clear 404 |
| Two publications claim the same public slug at once | Planned routing-lock doctest | Use one per-box shared-routing lock in addition to per-PubId locks; re-read slug ownership inside it and refuse a conflicting owner | Clear refusal |
| A private PubId path reaches a preexisting live manifest that was never approved for shared hosting | Planned shared Worker authorization doctest | Require the exact approved route marker as well as secret tier, PubId path, live manifest, and current box mapping | Clear 404 |
| Admin changes the box hostname after candidate preparation | Planned stale candidate doctest | Bind hostname and route into revision; approval compares candidate scope with the current mapping; enable checks the active manifest and its approved marker, independent of pending candidates | Clear stale-candidate error |
| New shared Worker deployment replaces an old per-publication Worker or route | Planned deployment identity doctest | Require explicit shared-mode identity and verify account, script, bucket, and mode before update; do not rebind old names | Clear refusal |
| Cloudflare returns HTTP 200 with `success:false` and useful `errors[]` | Planned provisioning adapter doctest | Preserve bounded validated provider code/message; never return raw body or credential-bearing request details | Clear provider diagnosis |
| A legacy per-publication hostname is already attached to the old Worker | Planned mapping-conflict doctest | Refuse the shared assignment; require explicit operator migration outside Bee Box; never auto-detach or move it | Clear conflict |
| The box has multiple publishing connection grants or publications pinned to different connections | Planned mapping/prepare doctest | Mapping names one connection; new publication preparation must use it; old publications on other connections keep existing URLs and cannot silently enter the shared route | Clear refusal and visible compatibility state |

No planned route has a silent critical gap. Provider live behavior remains unverified and no credential or real hostname changes are included.

## Agent-flow / user-flow edge cases

- Wrong route or slug: **ADDRESSED** — candidate validation and exact route-to-manifest checks reject mismatches; `/s` and Worker-owned route names are reserved.
- Stale ref/removed publication: **ADDRESSED** — the Worker reads current R2 manifest state on every request and fails closed when missing, disabled, revoked, or stale.
- Two agents preparing or changing paths concurrently: **ADDRESSED** — use existing per-PubId locking and make slug ownership an explicit read-before-write conflict check.
- Hand-edit drift: **ADDRESSED** — hostname comes from machine Admin mapping; candidate/manifests parse strict schema.
- Fabricated hostname/path: **ADDRESSED** — candidate scope is constructed server-side; agent cannot select a host.
- Validation errors: **ADDRESSED** — Admin, prepare, and approval errors name the conflicted host/path without exposing provider response bodies.
- Partial rollout: **ADDRESSED** — absence of the versioned shared-mode binding retains current pinned-PubId behavior; old manifest shape, workers.dev URLs, and manually attached custom hosts remain readable. Existing publications can enter the shared host only after a prepare/approval cycle writes the route marker. Their per-publication Workers keep parsing the old manifest schema and remain available.
- Private path discovery: **ADDRESSED** — no index/list route; `/s/<PubId>` remains the only secret route.
- Shared-origin trust: **ADDRESSED** — the human accepted same-origin storage and access among publications in a box. CORS is not treated as a security boundary.

## NOT in scope

- A single hostname that serves multiple boxes, because the user chose one hostname per box.
- Account-gated publication tiers, Access setup, or any new audience tier; they remain blocked until separately addressed.
- CORS-based isolation, iframe wrappers, per-publication origins, permissive cross-origin response headers, or private publication listing.
- Automatic Cloudflare deletion, hostname detach/reassignment, or rewriting existing `workers.dev` and custom-host URLs.
- Live Cloudflare credentials, DNS/certificate mutation, deployment, or account permission changes.
- Cross-box shared buckets or a box agent-readable Cloudflare credential. A fresh box may need its normal per-box/connection bucket provisioned during Admin setup.

## Open design questions

No product decision remains. The Admin control selects one existing connection granted to the box. It can configure a fresh box before the first publication. Other existing connection grants and per-publication hostnames remain in place and are not implicitly enrolled or moved. Public paths use `/<slug>/`; `/s` and Worker-owned `__*` paths are reserved.

## Knowledge audits

Update `beebox/docs/box/publishing.md` and the relevant `beebox/docs/box/what-you-could-do.md` entry to teach agents that they can prepare or refresh publication content but cannot choose the box hostname or approve the destination. Add focused `knows_directly` entries and run the knowledge audits for the new path and approval flow; do not give agents Admin credentials or authority.

## What will hold this after it ships

Add doctests for shared route resolution, stale pointer/manifest checks, candidate and approval destination binding, mapping and grant conflicts, and old Worker compatibility. Use the existing `pub-worker` Vitest tier for request behavior and beebox doctests for managed publication lifecycle. Do not add a new test tier. Tests prove code behavior; Cloudflare account permissions, DNS, certificates, and an actual attached hostname remain separately unverified.

## Implementation order

1. Lock schema/version design and add pure shared route resolution/authorization tests, including root-level public slug paths and reserved route names.
2. Add shared Worker mode while keeping old pinned mode and current manifest shape unchanged.
3. Add per-box machine mapping; Admin selects a granted connection, provisions/reuses its per-box bucket, deploys the shared Worker, and attaches the hostname before any publication exists.
4. Make new managed publication preparation, approval, and URL generation use the mapping and approved path; serialize slug pointer mutations with a shared-routing lock and retain legacy URL behavior.
5. Update box-facing docs and knowledge audits, then mark the prior per-publication hostname plan superseded after replacement implementation and verification.

## Rollout shape

Deploy code that recognizes both current pinned Worker bindings and the new explicit shared mode. New Admin mappings apply only to shared-host deployments; existing per-publication Workers and Cloudflare hostname attachments remain untouched. Same-connection existing publications appear on the shared host only after prepare plus member approval writes their route markers. A missing, malformed, or mismatched shared mapping serves no publication. Done when Worker route tests cover the Failure-modes table, lifecycle doctests prove approval and refresh behavior, knowledge audits pass, and selected tests/typecheck/lint pass. No live hostname setup is a completion gate for code behavior; it is a separate operational check that needs an explicit safe test hostname.
