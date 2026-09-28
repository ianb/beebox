---
title: "Assign a custom hostname to a prepared publication in Admin"
status: superseded
workstream: publish-pages
issues: []
superseded-by: ../plans/publish-shared-host-per-box.md
---
# Assign a custom hostname to a prepared publication in Admin

When a prepared site is disabled, a global admin can attach one exact hostname from an active Cloudflare zone to that site's Worker. A signed-in member of the owning box sees the hostname in the pending destination and approves it before enabling the site.

**Superseded (2026-09-26):** The boxholder chose one Admin-configured hostname per box and shared Worker instead of per-publication hostname setup. The old setup UI, RPC, and service were removed. Existing Workers, custom-host assignments, and URLs remain compatible; this plan records the retired setup direction, not the current workflow. See [the shared-host plan](../plans/publish-shared-host-per-box.md).

**Issues addressed:** none found in `issues/` for custom-domain assignment. This extends the approved publishing work in `beebox/docs/plans/publish-sites-admin.md` without closing its separate Access, submissions, or knowledge-audit follow-ups.

**Approved scope (2026-09-25):** The boxholder approved the combined discovery and custom-domain work with an estimated 1,750–2,450 authored changed lines. This is an estimate, not a hard stop; implementation should stay near the low end and report material scope growth before expanding it.

**Implementation status (2026-09-25):** Admin assignment, immutable hostname reservation, Cloudflare zone and Worker-domain preflight/attach/read-back, member destination approval, custom and workers.dev URLs, retry guards, and fake-backed coverage are implemented. The implementation has not been verified against a real Cloudflare account; DNS records, Workers Routes, certificate readiness, and browser-populated UI behavior remain live-verification gaps. Bee Box still has no hostname detach, release, or reassignment flow.

## Smallest fix and budget

The smallest useful change adds one global Admin action for an existing disabled publication: enter an exact hostname, discover its active zone, preflight current Worker-domain ownership, attach the Worker Custom Domain, and record the exact assignment. The account's existing publishing token must have Cloudflare's current minimum permissions. No wildcard, self-service domain grants, domain dashboard, or automatic cleanup is needed.

Estimate: 400–600 changed source lines and 250–450 doctest lines across the provisioning adapter, machine binding/manifest state, per-box owner-only Admin RPC/UI, publication actions, and member URL. Estimate 100–200 authored documentation lines. Approximate authored total is 750–1,250 lines; generated output is separate. Combined with discovery (up to 650 source and 200 documentation lines), the combined range is 1,600–2,100 lines. The approved 1,750–2,450 estimate includes overhead; implementation should target the low end. The existing `workers.dev` URL remains available and continues to enforce the same publication manifest. A custom hostname is a second route to the same Worker, not a replacement or a secret.

## Stated preferences this plan trades against

- **Human control of public destination.** The parent plan requires fresh signed-in member approval for every destination change (`beebox/docs/plans/publish-sites-admin.md:10,68`). Admin assignment makes the requested hostname visible; it must be included in the candidate revision and the approved edge manifest so stale approvals cannot authorize another destination.
- **One way to do each thing.** Reuse the existing Admin-only Cloudflare connection surface and publication state, rather than adding a hostname registry service or a second approval store (`beebox/src/webapp/trpc/routers/cloudflare-publish-connections.ts:27-35`; `beebox/src/publish/manifest-edge.ts:157-193`).
- **Validate at boundaries.** A hostname, zone list, Worker-domain list, and Cloudflare API response are untrusted inputs; parse and validate them before changing assignment state (`beebox/docs/engineering-principles.md:37-47`).
- **Work only on the requested problem.** `beebox/CLAUDE.md` limits work to the requested problem. V1 has one immutable custom hostname per publication; no detach/remap or broader domain allocation system.

## What already exists

- Candidate destination data is strictly parsed and hashed into `revision` (`beebox/src/publish/managed-publications.ts:28-65` (moved to `beebox/src/publish/managed-publications/core.ts`)). Requested scope is created from prepared publication settings (`:67-73`); extend this server-built scope with the optional custom hostname, never a box-authored value.
- `SiteEdgeManifest` is the serving authority and already carries the approved tier and slug (`beebox/src/publish/manifest-edge.ts:157-193`). Add the optional approved custom hostname there and validate it during approval and enable.
- Publication actions share a per-publication lock at `.beebox/publish-locks/<PubId>.lock` before reading and writing the remote manifest (`beebox/src/publish/managed-publication-actions.ts:9-16`). Admin assignment and member approval/enable must share this lock, using the bound box root.
- Admin connections are global-owner-only and token values never leave server custody (`beebox/src/webapp/trpc/routers/cloudflare-publish-connections.ts:27-61`). The machine secret store has connection and publication binding records (`beebox/src/core/secrets/store.ts:83-120`; `beebox/src/core/secrets/cloudflare-publish.ts:193-247`). Extend the publication binding with one immutable exact hostname.
- The provisioning client is an injectable Cloudflare API seam with a fake for deterministic tests (`beebox/src/services/cloudflare-provisioning.ts:73-100` (moved to `beebox/src/services/cloudflare-provisioning/core.ts`)). Extend it for zone discovery and listing, attaching, and reading Worker domains; no readiness probe is needed.
- Member URLs currently select the per-publication `workers.dev` hostname and path (`beebox/src/frontend/src/pages/PublicationsPage.tsx:274-280`). Public sites use `/`; secret sites use `/s/<PubId>/`. Account tiers are excluded from custom hostnames until Access is verified for both origins.

## Prior art (external)

- Cloudflare recommends Custom Domains when the Worker is the origin; the API creates DNS and certificates, requires an active zone, supports exact apex or subdomain hostnames, rejects existing CNAMEs, and does not support wildcard custom domains: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
- Discovering zones with `GET /zones` requires `Zone Read`. The Worker Domains API method documents `Workers Scripts Write` for attach; current Workers role documentation says Custom Domain changes need Worker `Editor` plus zone-scoped `Workers Routes Write`. This discrepancy must be checked in a safe test account before publishing exact permission instructions: [Workers roles and permissions](https://developers.cloudflare.com/workers/authorization/workers/), [List Zones API](https://developers.cloudflare.com/api/resources/zones/methods/list/), [Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/).
- The Worker Domains API has list/get/attach/detach endpoints; domain responses include hostname, service, zone, and certificate ID. V1 uses list and attach only: [Workers Domains API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/).
- Cloudflare says attaching creates DNS and issues a certificate. This preflight checks only Worker Custom Domain assignments; it does not inspect DNS records or Workers Routes, and it does not document that attaching preserves every pre-existing DNS record. Make this an explicit Admin confirmation and do not enable any override flags or delete DNS records.

## Ontology

- **Custom hostname assignment** (new, machine-owned): one exact hostname associated with one existing publication binding. It is not a capability token, audience decision, box-editable setting, wildcard grant, or replacement for `workers.dev`.
- **Requested custom hostname** (new, candidate scope): the assignment copied into the candidate when Admin maps it or the agent next prepares. It participates in the candidate revision and is what the box member reviews.
- **Approved custom hostname** (new, edge manifest): the hostname approved by a signed-in box member. It describes the approved destination alongside the existing tier/slug; the serving Worker still gates every URL from the same manifest status and audience.
- **Custom hostname assignment** (new, binding field): one exact hostname attached to one existing publication. V1 cannot detach or reassign it inside Bee Box. Cloudflare attachment begins DNS and certificate changes immediately, even while the site is disabled.

## Tracks / scope

### Track A — Worker custom-domain provisioning

**What:** Add the minimum zone and Worker-domain operations to `CloudflareProvisioningClient` and its Cloudflare adapter/fake.

**Why this needs to change:** The current client configures R2, Worker deployment and `workers.dev` only (`beebox/src/services/cloudflare-provisioning.ts:73-90` (moved to `beebox/src/services/cloudflare-provisioning/core.ts`)). Admin cannot map a hostname through the current seam.

**Direction:** Given the admin-entered hostname and bound Cloudflare connection, normalize and validate the hostname, list active zones for that account, and select the longest exact zone suffix. Check existing Worker Custom Domain ownership and verify the deployed Worker's `PUB_ID`, `HOST_HANDLE`, bucket binding, and script name match the server-owned publication binding before attaching. This does not inspect DNS records or Workers Routes. Cloudflare's Workers Domains attach API is a `PUT` and its docs do not promise compare-and-swap or create-only behavior. Serialize our app's assignment requests with a normalized-host lock plus the publication's existing lock. After preflight, reserve the hostname and revise the requested candidate before attach so a lost response cannot leave an unapproved hostname enabled. A retry reads the current Worker-domain assignment and adopts only the exact production service/zone tuple; if it maps elsewhere, fail closed. Cloudflare creates DNS and issues certificates; its public docs reject existing CNAMEs but do not specify behavior for every existing DNS record. Do not delete or enable override flags. Read back the attached Worker domain and verify exact host, service, environment, and zone. No certificate-ready state or background retry is introduced. Show “Hostname assigned; Cloudflare may still be provisioning HTTPS” until the member approves and the custom URL becomes the publishing link.

**Vocabulary lock-ins:** No new readiness state. The Cloudflare attach result and exact service read-back establish “hostname assigned”; they do not establish certificate readiness.

**First implementation chunk:** Fake-backed API tests for zone suffix matching, inactive/missing zones, same-service idempotence, conflicts, attach response parsing, and exact-service read-back. Confirm the permissions in a safe test account before documenting them. Do not change a credential or token automatically. Admin explains the confirmed required scopes and tells the owner how to update and resave the token if its current scope is insufficient.

### Track B — Exact immutable Admin assignment

**What:** Add an Admin flow to select a prepared publication and attach one exact hostname.

**Why this needs to change:** Cloudflare connections and per-box grants are managed in Admin today, but there is no custom-hostname assignment surface. The user asked to handle mapping from inside Admin.

**Direction:** Put the owner-only assignment mutation in the per-box Publications/Admin context so it receives `ctx.boxRoot` and `ctx.boxSlug`, lists only that box's prepared sites, and shares the member action lock. Require a remote manifest in `disabled` state. Use the connection and grant already bound to that site. Serialize under the existing PubId lock and a hostname-keyed lock that prevents simultaneous assignments by this app. Do not promise protection against an out-of-band dashboard race. Before attach, show the full site and hostname and state that Cloudflare will route every path of that hostname to the Worker and begin DNS/certificate changes immediately while the site remains disabled. After preflight, reserve the hostname and revise the candidate before attach; pending reservations block member approval and enable until exact service read-back. No detach/remap/release in v1: the hostname stays reserved to that publication in Bee Box even if an operator detaches it in Cloudflare. A replacement publication must use a different hostname. Require the owner to retype the hostname only if the reviewed UI makes the one-way effect unclear; otherwise a direct, explicit confirmation is enough.

**Vocabulary lock-ins:** one exact hostname per publication; server-owned assignment; no agent-selectable host value.

**First implementation chunk:** An owner-only mutation maps a hostname to one disabled prepared publication under both locks, updates candidate requested scope plus revision, and records the assignment. A repeated identical assignment is idempotent. An existing assignment or provider domain for another publication fails closed. A retry after attach succeeded but local persistence failed confirms provider ownership before finishing the same assignment.

### Track C — Member approval and publishing link

**What:** Show the requested custom hostname in Publications, bind approval to it, and provide a clickable publishing link after approval.

**Why this needs to change:** Candidate revisions currently cover tier/slug but not the custom hostname (`beebox/src/publish/managed-publications.ts:28-65` (moved to `beebox/src/publish/managed-publications/core.ts`)). A member must know which destination they are approving, and approval must not remain valid if that destination changes.

**Direction:** The Admin assignment adds `customHostname` to candidate requested scope and recomputes its revision using the existing stable serializer. `approveManagedPublication` copies it into the approved edge manifest. A stale expected revision fails as today. Include hostname in `sameAudience`; reject approval unless candidate hostname matches the server binding, and reject enable unless the approved manifest hostname matches that binding. This closes the direct-enable bypass. The member sees the requested hostname before approval, and after approval gets a clickable link using the custom host and existing path (`/` or `/p/<slug>` for public, `/s/<PubId>/` for secret). Keep workers.dev as an alternate. Both hosts serve the same Worker, manifest, audience, and enable/disable state. Secret capability remains in `/s/<PubId>/`, never in the hostname. Custom hostnames are limited to public and secret tiers until Access is verified for both origins. Every content refresh inherits the server binding's hostname so approved refresh remains in scope.

**Vocabulary lock-ins:** `customHostname?: string` appears in candidate requested scope and the edge manifest's approved scope. The assignment record and candidate must agree; reject mismatches.

**First implementation chunk:** Add scope equality, schema, query, approval and UI coverage for no hostname, requested hostname, stale candidate, direct-enable mismatch, and both URL hosts. Approval and enable check the assignment; the Worker continues to use manifest status and audience as serving gates.

## Could this be simpler?

Admin could provide a manual Cloudflare link and ask the boxholder to configure a hostname in the Cloudflare dashboard. That avoids the API, locking, and token-permission work, but does not satisfy the request to map domains inside Admin or give members an in-app destination approval. Exact assignment to one existing disabled site buys that workflow while avoiding a general domain registry or agent-facing allocation system, consistent with `beebox/CLAUDE.md`'s narrow-scope rule.

## Subplans

None. Cloudflare's attach permission is checked in Track A; no live credentials or production zone changes are part of implementation verification.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Zone suffix matching selects the wrong zone or an inactive zone | Planned provisioning doctest | Require exact hostname suffix, longest matching active zone, and same connection account | Clear failure |
| Hostname belongs to another Worker Custom Domain or has existing DNS/Workers Route state | Fake Worker-domain API tests; DNS/routes are not inspected; live integration still needed | Preflight only the Worker Custom Domain list, fail closed on known domain conflicts, and verify the exact service after attach. The API docs do not promise conditional attach. Admin confirms DNS/certificate effects; never delete DNS records | Clear refusal for known Worker Custom Domain conflicts; existing DNS/Workers Routes and out-of-band race remain outside preflight |
| Same hostname is assigned by two app Admin requests at once | Planned concurrency doctest | Acquire normalized-host lock then PubId lock; re-read assignment and provider ownership inside both | Clear refusal |
| Assignment races member enable or another admin action | Planned concurrency doctest | Use the same per-publication lock and re-read disabled status immediately before attach | Clear refusal |
| Cloudflare attach succeeds but response is lost | Planned retry/idempotence doctest | List domains; only recognize same-host/same-service/zone as this assignment and finish the same local update | Clear assignment state; no new host claim |
| HTTPS certificate is still provisioning | No readiness probe in v1 | Show that the hostname is assigned and Cloudflare may still be provisioning HTTPS; only make it the member's published link after approval | Visible limitation; link may not open immediately |
| Owner maps the wrong hostname or changes an active website's routing | Admin confirmation doctest | Confirmation names the host/site and says every path will route to Bee Box and DNS/certificate changes begin now. Assignment requires a disabled site and cannot be undone from Bee Box | Clear irreversible effect |
| Candidate changes after Admin maps hostname | Planned stale-revision doctest | Recompute candidate scope/revision on assignment under lock; expected revision must match on approval | Clear stale candidate |
| Custom URL points to the wrong tier path | Planned URL helper doctest | Reuse existing path rules and construct URLs from approved manifest scope | Clear, testable |
| `workers.dev` still exposes the same publication | Planned UI/security contract test | Intentionally retain it as alias to the same Worker; it has identical audience and status gates | Visible and documented |

## Agent-flow / user-flow edge cases

- Wrong host value: **ADDRESSED** — only a global admin enters an exact validated hostname; box definitions cannot set it.
- A hostname is already in use: **ADDRESSED** — refuse known mappings to another Worker; exact-domain provider read-back is required. Out-of-band races are an explicit limitation because the API documents no conditional attach.
- Stale publication preview: **ADDRESSED** — the destination is in candidate revision and member approval checks expected revision.
- Two agents or admin and member concurrently act: **ADDRESSED** — publication mutations share the per-PubId lock.
- Partial attachment or delayed certificate: **ADDRESSED** — an interrupted action can be retried idempotently after checking Cloudflare domain ownership; delayed HTTPS is disclosed without adding state or background retries.
- Hostname assigned to wrong prepared publication: **ADDRESSED** — Admin confirms full hostname and publication title before the irreversible DNS/domain attach; there is no Bee Box remap or release in v1, and Cloudflare detach does not clear Bee Box's permanent reservation.
- Validation error UX: **ADDRESSED** — map errors to sanitized actionable messages (inactive zone, missing permission, existing domain, wrong account, attach failure).
- Existing hostname migration: **ADDRESSED** — no existing Worker or URL is rewritten. New custom host is an alias; old workers.dev link keeps working.

## NOT in scope

- Detach, remap, release, delete, or transfer a hostname. A hostname stays reserved to the original PubId in Bee Box even after manual Cloudflare detach; another publication cannot claim it.
- Wildcard domains, user self-service grants, agent-chosen hostnames, arbitrary aliases per publication, external customer zones, or a shared custom-domain hostname router.
- Automatically disabling or removing `workers.dev`; it remains an alias with identical audience and status gates.
- Hostname secrecy, new Access policy behavior, redirecting between apex and `www`, DNS record cleanup, or certificate inventory cleanup.
- Live Cloudflare writes during development or deployment.

## Open design questions

The Cloudflare API method docs and current role docs disagree about the attach permissions. Confirm exact minimum token scopes in a safe test account before documenting them. If existing credentials lack the required scope, the owner updates/resaves the token manually; Bee Box never edits or rotates it. There is no live hostname or certificate probe in v1.

## Knowledge audits

No box-agent knowledge audit: hostname mapping is an Admin/operator and member UI capability, and the agent has no new instruction or authority.

## What will hold this after it ships

Add doctests for the provisioning adapter, custom-hostname assignment and conflict rules, candidate/manifest destination revision, Admin owner-only boundary, direct-enable rejection, refresh inheritance, and member link/approval behavior. Reuse fake Cloudflare provisioning; do not add a new test tier. A human-present test hostname session must verify permissions and attach behavior before operational reliance; do not edit or detach a production hostname or DNS record as part of that check.

## Implementation order

1. Extend the injectable provisioning interface and fake with zone discovery, Worker-domain list/attach/read-back.
2. Add exact assignment and candidate/edge-manifest destination state; serialize with all existing PubId mutations.
3. Add per-box owner-only Admin assignment UI with an explicit DNS/certificate confirmation and immutable assignment result.
4. Add member approval destination and canonical/alternate HTTPS links; test path and tier parity.
5. Confirm documented Cloudflare permissions on a safe test hostname; update publishing guidance.

## Rollout shape

No data migration: existing publication bindings and manifests parse without a custom hostname; optional fields default absent. The first new Admin assignment is allowed only when the existing publication is disabled. Done when the provisioning, candidate revision, lock/concurrency, approval, owner-only, and URL doctests pass; typecheck and lint pass; and a safe test-host verification confirms Cloudflare's minimum permission behavior, attach and read-back. This live test does not certify certificate readiness or authorize a production hostname assignment.
