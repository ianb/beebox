# Plan Engineering Review — publish-sites-admin

Review basis: an earlier draft, reviewed before concurrent cleanup. Findings below have been adjudicated against the current proposal. This is a proposal review, not implementation approval.

## What already exists

The current publication model uses `PubId`, a local manifest, and a bundle (`beebox/src/publish/manifest.ts:75-91,146-154`). The edge projection deliberately omits box identifiers and source refs (`beebox/src/publish/manifest-edge.ts:14-20`). Worker routes share one origin and select tier by `/p/`, `/s/`, and `/a/` (`beebox/pub-worker/src/index.ts:5-10,85-120`). The current bundle is mutable at `pubs/<id>/bundle/`; `manifest.files` records file metadata but serving does not enforce it as an allowlist (`beebox/src/publish/lifecycle.ts:58-65`; `beebox/pub-worker/src/index.ts:168-189`).

## Ontology (verified against the code's own names)

The proposal now distinguishes `PubId` (the stable publication identifier and, for secret tier, current path capability) from `hostHandle` (a non-capability hostname label). It also distinguishes `disabled` from terminal `revoked`, and uses immutable release IDs, an active release pointer, and a per-release allowlist. These are not interchangeable identities or states.

## Prior art (external) — verified

Cloudflare documents `workers.dev` hosts per Worker and limits of 100 Workers per Free account and 500 per Paid account ([routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [limits](https://developers.cloudflare.com/workers/platform/limits/)). Custom Domains require an active zone and do not support wildcard custom domains; wildcard Routes need proxied DNS and are not the recommended application-origin pattern ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)). Wrangler device login exists in 4.119.0 and later ([Wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/general/)); this repo pins 4.108.0 (`beebox/pub-worker/package.json:24`). Device login proves browser approval can authenticate the CLI machine; it does not provide the per-box server-secret custody flow proposed here. Live API behavior, Access cookie isolation, and per-publication Access app creation remain unverified.

## Stated preferences this plan trades against

Per-publication Workers buy separate browser origins for authored JavaScript, at the cost of Worker quota and per-publication deployment. The move from an ingestion-only connector secret to server-resolvable content-write and Worker-deploy authority is a larger trust-boundary change. The human has chosen per-box admin secret grants and no new sandbox; the plan must state that a same-OS-user agent/server compromise can use the granted credential. This is an accepted residual, not a claim that custody creates a sandbox.

## Could this be simpler? (verified)

The smallest core is a finished static folder, a strictly copied bundle, a disabled-by-default publication, and human enable/disable. Keep JSON export and React helpers optional follow-on conveniences; “optional” means consumers may use them, not that Bee Box must never provide them. Remove the MIME-map alignment work: the Worker chooses served `Content-Type` by extension (`beebox/pub-worker/src/index.ts:187-189`; `beebox/pub-worker/src/content-type.ts:7-16`), while upload metadata is not the serving authority. A static-folder build needs path validation and a safe copy, not a per-site package manager or general build system.

## Failure modes

The proposal now uses immutable release directories, an `activeRelease` pointer, and release-qualified resource URLs so a browser stays on one release. Retain the active and previous release for ten minutes; current publication and audience permission gates still apply on every asset request, so disable or audience changes invalidate old URLs. `disabled` is reversible; `revoked` remains terminal.

## Agent-flow / user-flow edge cases

Any signed-in member of the box may enable or disable after the Cloudflare connection is granted to that box; the human has explicitly chosen this boundary, so a global owner-only procedure is not required. Agent content refresh preserves approved tier, recipients, destination, and `hostHandle`. Audience edits remain pending for human approval. Initial browser consent/live Cloudflare validation needs the human; later approved refresh operations do not. An agent cannot enable a publication through a CLI bypass.

## Findings

### 1. Record the credential custody change and residual trust

**Location in plan:** Cloudflare credential custody; failure modes.

**Citation:** The prior credential model says “the headless connector holds only an ingestion-bucket-scoped R2 token” (`beebox/src/services/cloudflare-provisioning.ts:20-25`; `beebox/pub-worker/wrangler.jsonc:10-19`).

**Issue:** The new admin grant allows the server to write live content and deploy Workers. Per-box secret custody controls which box resolves it; it does not isolate agent code running as the same OS user.

**Why it matters:** A compromised box or same-user agent could change published content or Worker code. The plan's “Critical gap: none” claim overstates this control.

**Suggested action:** State this as an explicit, accepted trust-boundary change. Do not add a new sandbox. Keep Access-admin and token-mint authority outside the agent-resolvable grant.

**Adjudication:** Accepted direction per parent decision; document the residual and let the human choose the Cloudflare admin secret.

### 2. Keep secret `PubId` out of the hostname

**Location in plan:** Publication host and secret-link identity.

**Citation:** Secret `PubId` is the capability token (`beebox/src/publish/manifest.ts:76-79`); the earlier plan says “secrecy lives only in the path segment, never in the hostname” (`beebox/docs/plans/publish-pages.md:57`).

**Issue:** Deriving Worker name/hostname from `PubId` puts the secret capability in public host metadata.

**Why it matters:** Hostnames appear in DNS and TLS infrastructure, so the `/s/<PubId>/` path no longer contains the only capability-bearing value.

**Suggested action:** Keep `hostHandle` as a separate non-capability name; keep secret `PubId` only in the path and publication data.

**Adjudication:** Incorporated in the current proposal.

### 3. Keep JSON/export and React optional in implementation order

**Location in plan:** Static site core and implementation order.

**Citation:** The reviewed draft called JSON/React “optional conveniences” but put explicit JSON export in the early implementation steps.

**Issue:** The plan promotes optional data/export machinery into the first static-site path and its audits.

**Why it matters:** This expands the core beyond bespoke HTML and a safe static folder.

**Suggested action:** Finish static-folder publication first. Put JSON selection helpers and a React starter in a separate optional chunk. Keep the helpers available to consumers who choose them; do not require either a `package.json` or dependency installation per site.

**Adjudication:** Incorporated: static folder is the core; JSON/React remain optional. MIME metadata-map alignment was removed.

### 4. Define disable and immutable release semantics

**Location in plan:** Publication state and release update behavior.

**Citation:** Current status is `draft | live | revoked` (`beebox/src/publish/manifest-edge.ts:30-31`); revoked publications are not reusable (`beebox/src/publish/go.ts:153-158`). Bundle keys use one mutable prefix (`beebox/src/publish/lifecycle.ts:58-65`), and the edge manifest has no release pointer (`beebox/src/publish/manifest-edge.ts:74-80`).

**Issue:** Re-enableable disable and coherent multi-request refresh need explicit state and URL semantics beyond an atomic manifest write.

**Why it matters:** A page opened on release A could otherwise fetch JS/JSON from release B or receive 404 after old assets are removed; revoked cannot represent temporary disable.

**Suggested action:** Keep reversible `disabled` separate from terminal `revoked`; use `activeRelease`, per-release file allowlists, release-qualified URLs, and active-plus-previous-ten-minute retention. Enforce current permission state on every request.

**Adjudication:** Incorporated in the current proposal, including the ten-minute prior-release window and permission-based invalidation.

### 5. Use token-first custody as baseline; leave device-login brokerage open

**Location in plan:** Cloudflare credential custody.

**Citation:** Wrangler credentials and bearer retrieval live on the machine running Wrangler (`beebox/src/services/wrangler.ts:5-8`; `beebox/src/services/cloudflare-bearer.ts:39-43`).

**Issue:** A browser device-code flow exists, but the current CLI version is older and the flow authenticates the CLI machine; it does not itself place a suitable credential into the per-box secret store.

**Why it matters:** Treating device login as a complete remote admin-secret design would leave custody and permissions unresolved.

**Suggested action:** Make the explicitly scoped, verified token grant the v1 custody baseline. Keep device OAuth or a brokered token flow as an open integration question; do not claim Cloudflare API creation/readback or Access cookie behavior is live-verified.

**Adjudication:** Token-first baseline accepted. Device flow is a real CLI capability, but box-secret brokerage and Cloudflare API behavior remain open.

## NOT in scope (verified)

Submissions, access-log ingestion, views, shared-bucket tenancy, automatic migration of old live publications, and a hostile-code sandbox stay out of this proposal. Optional JSON/React helpers are follow-on conveniences, not prerequisites for the static HTML core.

## Things I checked and found clean

The reviewed draft kept submissions and connector work out of scope; the current plan retains that boundary. The reviewer confirmed the `manifest.files` map is not currently an allowlist and that the shared-origin CSP concern is real. The current plan reflects the human's choice that any signed-in box member may toggle after admin grant. Initial Cloudflare API behavior, Access cookie scope, and per-publication Access app setup still require live validation; this review does not claim that verification.

## CDN resource-policy addendum (parent-adjudicated after review)

This is a narrow update after the original Claude snapshot, based on the latest human steering. The human confirmed the resource policy scope is published sites only; other authored-JavaScript surfaces remain outside this plan.

- The plan now allows direct external HTTPS scripts/modules, stylesheets, fonts, and images without a fixed CDN allowlist. Author-chosen URLs are trusted dependencies; neither CDN use nor local package bundling is claimed inherently safer. Version pins improve reproducibility but do not cryptographically freeze transitive dependency graphs. Remote URLs add provider availability/request-observation tradeoffs; vendoring a snapshot remains optional for offline, frozen-byte, or no-third-party-contact use. A runtime own-origin proxy is not the v1 baseline because it adds upstream/transitive resolution, caching, and another service to operate.
- `connect-src 'self'` remains the default for same-origin JSON. Arbitrary external data APIs are a separate future policy decision. Restricting fetch does not make arbitrary approved page code confidential or prevent every communication path.
- Published responses add `Cross-Origin-Resource-Policy: same-origin`, retain `nosniff` and `no-referrer`, and send no permissive CORS header. Browser checks cover classic-script embedding and credentialed CORS fetch from another publication while authorized to the protected target. External ESM imports still require the source host's CORS support.
- Direct URL module imports need no inline import map. Any future import map must be covered by CSP hash; no proxy is proposed. React helper may bundle locally or emit version-pinned ESM URLs without an app-host shim.

Relevant premises: [MDN CORP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cross-Origin_Resource_Policy), [MDN script/importmap](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap), [esm.sh documentation](https://github.com/esm-dev/esm.sh/blob/main/README.md).


## Bundler and dependency-flow addendum (parent revision after reviewer snapshot)

The later human direction makes project builds part of core publication: static pass-through remains available, while declared JS/TS/JSX projects use site-local `package.json` and `pnpm-lock.yaml`, frozen install, and conventional `pnpm run build` to `dist/`. A starter may use esbuild or Vite, while a project may choose an ordinary bundler through its declared dependencies/build script. It captures imported JS/CSS/assets; bare dependencies must be declared and installed, while absolute HTTPS imports remain external. The box engine package is separate because engine init skips dependency installation; this plan does not change/link it. Only `dist/` is uploaded and served. The reviewer snapshot predates this bundler flow, which follows later human direction and is not an independently verified implementation claim. Full site-local `package.json` support supersedes the earlier draft preference to avoid per-site manifests.

The narrow Fable CDN-policy review completed successfully (exit 0); both findings were accepted and applied: cite the MDN JavaScript modules guide for ESM CORS behavior, and describe remote dependency/version-pin tradeoffs without asserting CDN imports are inherently safer. No review remains pending. The published-site CSP proposal is:

```text
default-src 'none';
script-src 'self' https:;
style-src 'self' 'unsafe-inline' https:;
img-src 'self' data: https:;
font-src 'self' data: https:;
connect-src 'self';
worker-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
form-action 'none'
```

It retains `nosniff`, `no-referrer`, CORP same-origin, and no permissive CORS. It adds no eval/wasm execution. A generated import map, if later supported, requires a CSP hash.

## Build-process hygiene and atomic refresh (parent-adjudicated)

The current proposal runs site install/build subprocesses with a minimal explicit environment, excluding inherited server and agent credential variables. This reduces accidental credential exposure; it does not sandbox trusted authored code or change its existing filesystem privileges. Project install/build/scan run to staging; upload and `activeRelease` promotion happen only after successful completion. Failure, nonzero exit, or timeout leaves the active release serving and does not publish partial output. Tests for these failure paths are added to the plan. These are parent-adjudicated design additions after the Fable snapshot, not independently reviewed implementation behavior.

## Optional authoring golden-path delta review (Fable, completed)

Fable's narrow review of the React/Tailwind golden path and shared scoped notes completed successfully (exit 0). Its only remaining finding was that the original `Path:` note heading excluded static-mode files. The plan now uses `<site>/<relative-path>` and gives both `<site>/site/<subdir>` and `<site>/project/src/<subdir>` examples. The review confirmed the starter is included with the installed box-docs authoring guide and copied by the agent when desired; no auto-created site or initialization scaffold is specified. The review's former concern that the starter was absent from the implementation scope was already corrected before the final review. Notes use one shared file; no per-site notes files are proposed.

The human clarified that the starter should be neutral and competent, not Bee Box-branded. The plan now calls for semantic CSS tokens, accessible contrast and focus states, sensible typography and spacing, responsive layout, standard components, and a simple useful homepage. Bee Box frontend conventions are structural references only; no palette research or additional dependencies are required.
