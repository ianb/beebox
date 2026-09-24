---
title: "Static site publishing with admin setup and human approval"
status: active
workstream: publish-pages
issues:
  - ../../../issues/features/2026-07-19-pub-access-setup-via-api-not-dashboard.md
---
# Static site publishing with admin setup and human approval

When an agent prepares a small site from box data, the boxholder should be able to enable or disable that publication in the app, without using a CLI. Agents may update the published content, but every audience or destination change needs fresh approval from a signed-in member of that box.

**Issue relationship:**

- `issues/features/2026-07-19-pub-access-setup-via-api-not-dashboard.md` — retain API-based Access setup and complete its pending real-account verification in the new per-publication hosting shape; close only after that live proof.

This addresses the publication-approval portion of `issues/features/2026-07-19-publish-pages-resume.md`; it does not resolve that broader issue's docs, submission loop, or knowledge-audit work by itself.

Related but not resolved: `issues/bugs/2026-08-21-published-pages-can-never-carry-a-submit-form-nothing-s.md` (submission forms are out of scope); `issues/code-quality/2026-07-31-pub-worker-preauth-oracle-and-log-flood.md` (existing Worker hardening); `issues/decisions/2026-09-05-publish-connector-env-credential-bypasses-grants.md` (submission connector credential path).

## Smallest fix and budget

The smallest useful change is an agent-authored folder of finished HTML, CSS, JavaScript, and assets, plus a per-publication authorization toggle used by any signed-in member of that box. Core accepts either a finished static folder copied as-is or a declared JavaScript/TypeScript/JSX project built through its standard build script. Plain files need no package manifest or build. Project mode uses a site-local standard `package.json` and `pnpm-lock.yaml`; an agent maintains dependencies and the conventional `build` script. Publishing installs from the frozen lockfile, runs `pnpm run build`, scans and uploads only `dist/`, and never serves source or `node_modules`. Cloudflare serves static output only; no visitor-time build or Node runtime. Deliver a lazy authoring guide and an optional React/Tailwind starter golden path; sites may use it or choose any other stack. JSON export remains an optional convenience.

Authored same-origin JavaScript on a shared origin could request account-tier paths from a public page and receive a response with the viewer's Access cookie. The current Worker uses `connect-src 'none'`; relaxing it on a shared origin would be unsafe. This proposal therefore recommends one Worker hostname per publication. Cloudflare documents 100 Workers per Free account and 500 per Paid account; the limit makes per-publication isolation a real account-capacity tradeoff, not an unlimited default ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).

**BIG CHANGE:** the preliminary core estimate was 2,800–3,800 changed source and test lines, including admin connection custody, box-member authorization, static/project preparation, the React/Tailwind starter, pinned publication Workers, and release-pointer serving. The implementation's realized scope is about 4,353 changed lines across source/build (3,189), tests (1,070), and authored knowledge-audit cases (94). Documentation is about 1,339 changed lines, including the installed guide, operator guide, plan, and cross-model review; generated context-history adds 208 lines. This modest overrun was accepted for the complete approved scope. Starter adoption remains optional. Strict JSON export is a separate optional follow-on with its own implementation estimate; generated bundles are not included.

**Approved scope:** the boxholder approved this implementation scope on 2026-09-24. The accepted v1 Worker budget is one isolated Worker per publication, within current account quotas (100 Workers on Free / 500 on Paid); show capacity exhaustion clearly rather than introducing shared-bucket multi-tenant dispatch.

**Implementation status (2026-09-24):** Public and secret managed-site flows are implemented in this worktree: static folders and locked project builds prepare immutable releases; agents can refresh only the approved scope; signed-in box members inspect, enable, disable, and approve audience/destination changes in the app. The React/Tailwind starter, installed authoring guidance, scoped private notes, admin connection custody, and four core knowledge audits are included; all four audits passed. The optional JSON-export helper is deferred. Account-restricted tiers remain blocked in the app until per-host Access setup/readiness and browser verification are implemented and proven. No real Cloudflare credential, API call, or Worker deployment has been used, and this work is not landed. The human-present live session remains required to verify Cloudflare setup, enable, refresh, disable, and Access behavior.

**Validation evidence (2026-09-24):** Backend and frontend typechecks, `lint:changed`, `build:cli`, and `git diff --check` passed. The full changed-test selector selected 552 files and reported 7,433/7,437 assertions passing; its four failures were stale generated-box inventory expectations after adding two shipped Markdown files. The corrected inventory/migration cases and supervisor test then passed 61/61 assertions. Focused auth/session and publication service/router regressions passed 94/94 assertions; Worker tests passed 65/65. A later selector rerun was intentionally stopped after eight files and is not counted as a test result. These fake-backed checks do not establish Cloudflare account behavior, deployment success, Access cookie scope, quotas, or live browser results.

## Stated preferences this plan trades against

- **One way to do each thing.** Engineering principle 8 says “Competing idioms are drift generators” and “Consolidate over blast-radius fear” (`beebox/docs/engineering-principles.md:95-104`). The build uses the existing strict card reader/ref resolver and the existing publication bundle instead of inventing a second card renderer or hosting protocol.
- **Validate at boundaries.** Principle 3 names “Disk reads, LLM output, HTTP bodies, third-party API responses, config files, and env vars” as inputs to validate (`beebox/docs/engineering-principles.md:37-47`). Site definitions, optional export output, and manifests are parsed strictly; the Worker continues validating edge manifests.
- **Right-sized defensiveness.** Principle 6 says “Defense concentrates at real boundaries” (`beebox/docs/engineering-principles.md:75-85`). Build code is trusted local code with the box's existing privileges; the design adds no pretend sandbox. It validates files, paths, refs, schemas, and upload scope where data crosses into the public bundle.
- **Human control of public content.** The existing plan says a publication bundle is “fully public content” regardless of tier (`beebox/docs/security-overview.md:180-190`). A signed-in member of the owning box enables publication; global admins separately manage Cloudflare connections and grants. Leak scanning remains a backstop, not proof that selected content is safe.
- **Isolation has an operating cost.** Per-publication Workers add deployment count and consume account quota. The isolated origin supports authored same-origin JavaScript without sharing a cookie-bearing origin across publications.

## What already exists

- The current `bbx pub draft` writes `_publish/<pub-id>/manifest.json` and `bundle/` output (`beebox/src/publish/draft.ts:229-242`: “Write the draft to the working tree”). Reuse the stable publication id and manifest location, but new publication uploads use immutable releases and a new server-mediated refresh path rather than the draft-only `go` path.
- The edge manifest is stored in R2 and intentionally drops “provenance, source refs, and every box identifier” (`beebox/src/publish/manifest-edge.ts:14-20`). Reuse it for serving authority, adding only fields required for box-member-approved destination/audience and per-publication routing. Do not add a third publication-state store. Extend the existing edge manifest with reenableable `disabled` status distinct from terminal `revoked`, an `activeRelease`, and immutable per-release file inventory.
- The current Worker reads the R2 manifest, checks tier/expiry, then serves files (`beebox/pub-worker/src/index.ts:110-121,168-189`). Its `serveAsset` normalizes paths but does not check the requested path against `manifest.files`; make each immutable release inventory a positive allowlist.
- The Worker sets response MIME by extension (`beebox/pub-worker/src/content-type.ts:7-16`); upload metadata MIME is not used to choose served Content-Type (`beebox/pub-worker/src/index.ts:183-189`). Test served MIME with `nosniff`; do not add a separate metadata-map alignment task.
- The current security headers include CSP, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`, but do not set CORP (`beebox/pub-worker/src/headers.ts:18-40`). Published sites need `Cross-Origin-Resource-Policy: same-origin` and no permissive CORS before allowing external HTTPS imports, so other origins cannot embed a protected classic script. The current CSP has `script-src 'self'` and `connect-src 'none'`; the proposal widens script/style/font/image sources to HTTPS and retains same-origin fetch by default.
- The leak scanner scans text bundle files and skips binary files (`beebox/src/publish/leak-scan.ts:13-40,193-205`). It already reports absolute HTTP(S) references and credential-like text (`beebox/src/publish/leak-scan.ts:22-29,151-184`). Scan generated JSON, HTML, JS, CSS, and assets; a clean result is not semantic privacy review.
- Canonical ref handling already exists. `beebox/src/shared/ref-path.ts:90-119` parses ref suffixes, and `beebox/src/core/ref-exists.ts:59-73` resolves card/attachment refs within the box. Reuse these helpers and existing card I/O (`beebox/src/core/card-io.ts:400-411`); never emit raw box refs.
- The machine secret store holds credentials outside box trees and applies per-box grants (`beebox/docs/secrets.md:1-16,41-55`). Its admin API uses `authenticatedOwnerProcedure` because the store spans boxes (`beebox/src/webapp/trpc/routers/secrets.ts:5-17,45`; `beebox/src/webapp/trpc/trpc.ts:65-81`). Reuse that global-admin-only management boundary for Cloudflare connections and grants.
- The older plan's view direction inlined card data in HTML (`beebox/docs/plans/publish-pages.md:107-114`); its proposed view subplan is absent (`beebox/docs/plans/publish-pages.md:169-173`). This plan replaces implicit whole-card rendering with authored site code. A static-site precedent keeps public output as reviewed generated files (`beebox/docs/plans/public-site-box-authoring-export.md:54-65,358-383`), but its editorial site has different semantics and is not reused as a publishing service.

## Prior art (external)

- Cloudflare assigns each Worker a hostname shaped like `<worker>.<subdomain>.workers.dev`; no custom domain is required ([workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)). Wrangler device login is documented ([Wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/general/)); verify it with the pinned version before selecting this connection flow. This supports the proposed per-publication origin, subject to the per-account Worker limits above.
- Cross-Origin-Resource-Policy `same-origin` blocks no-CORS cross-origin resource embedding; CORS remains separately required for cross-origin modules ([MDN CORP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cross-Origin_Resource_Policy)). JavaScript modules use CORS for cross-origin loads ([MDN JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)).
- `esm.sh` provides versioned ESM URLs; use explicit versions if chosen, while treating its transitive graph and availability as provider dependencies ([esm.sh README](https://github.com/esm-dev/esm.sh/blob/main/README.md)).
- Access can protect a Workers hostname and forwards `Cf-Access-Jwt-Assertion` after login ([Workers Access setup](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)). Access cookie scope, wildcard app behavior, and app/audience setup for this exact per-publication arrangement are not verified; the real browser pass is a gate, not an assumption.
- Cloudflare Custom Domains require an active zone and do not support wildcard DNS records ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)). Wildcard Worker Routes need a proxied DNS record and are not the recommended application-origin pattern ([Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)). Do not build the wildcard/custom-domain alternative in v1.
- Cloudflare Workers for Platforms provides wildcard hostname routing and dispatch, but it is a separate platform architecture ([Workers for Platforms hostname routing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/hostname-routing/)). It is not necessary for a bounded per-publication design.

## Ontology

- **Publication source** (new): agent-authored files in `src/publications/<name>/site/` for static mode, or `src/publications/<name>/project/` for a standard project build. Shared authoring guidance and private cross-publication notes live under `src/publications/`, never in generated output or a card schema.
- **Publication definition** (new): strict `publication.json` binds stable `PubId` to a named Cloudflare connection, content mode, title, and requested tier/recipients/slug. Content mode fixes the source root to `src/publications/<name>/site/` or `src/publications/<name>/project/`; no arbitrary source path or build command is accepted. Output paths, bucket, Worker name, and random `hostHandle` are assigned/derived server-side and are not definition fields. It is agent-editable desired config, not box-member approval or credential; refresh preserves stable id.
- **Publication** (existing `PubId`, `PublicationManifest`): one stable secret `PubId` and `_publish/<pub-id>/manifest.json`; current content is under `bundle/` (`beebox/src/publish/manifest.ts:75-91,146-154`; `beebox/src/publish/draft.ts:229-242`), while new releases are immutable directories selected by `activeRelease`.
- **Approved scope** (new manifest fields): box-member-approved tier, recipients, destination/slug and isolated Worker hostname stored in the existing edge manifest. The edge version is authoritative; local definition is a request. Content refresh may advance `activeRelease`, but cannot change approved scope.
- **Cloudflare connection** (new admin object): named account id plus credential in the machine secret store. Admin-owned; a per-box server-only grant allows the publisher service to use it. It is not readable by agent-context code.
- **Publication Worker** (new deployment shape): same Worker code deployed under one script/hostname per publication, pinned immutably to one `PubId`. Its random, non-capability `hostHandle` is not derived from the secret id. It can read only `pubs/<that-id>/...` even when several publications share a per-box R2 bucket.

## Tracks / scope

### Track A — Admin Cloudflare connections and per-box grants

| Admin-owned connection and grant | Agent-owned publication request |
|---|---|
| Account identity, credential custody/type, verified capabilities, named connection, per-box server grant, rotation/revocation | Stable `PubId`, content mode (`static` or `project`), source root, title, requested tier/recipients, slug; optional JSON exporter or optional adoption of the shipped starter |

Static mode publishes finished files from `site/` with no package manifest or build. Project mode uses a separate `project/` directory with a normal `package.json`, `pnpm-lock.yaml`, and `src/`; the conventional `build` script writes `dist/`. The box root has engine-managed `package.json` dependencies, but engine init intentionally skips `pnpm install` because its engine package is not registry-resolvable (`beebox/src/core/box/package.ts:141-154,190-222,247-253`). A nested package template precedent exists (`beebox/src/core/box/templates.ts:35-45,99-107`). Keep the site package and lock independent; do not alter or link against the box engine package. Site dependencies and `node_modules/` remain project-local and ignored by publication; deploy only `dist/`.

Proposed metadata shape (names illustrative, not an existing schema):

```json
{
  "pubId": "abcdefghijklmnop2345672345",
  "connection": "personal",
  "content": "static",
  "title": "Project notes",
  "tier": "secret"
}
```

Project mode uses the same definition with `"content": "project"`; the server derives the project root from the publication directory, and its conventional build script owns the entry and `dist/` contract. Definitions do not accept source/output paths, bucket names, Worker names, or command strings.

```text
src/publications/project-notes/
  publication.json
  site/index.html
  site/styles.css
  site/app.js
  project/             # alternative source-project mode
    package.json
    pnpm-lock.yaml
    src/main.tsx
    # package.json declares a conventional build script to dist/
    dist/               # generated; only this output is published
src/publications/
  CLAUDE.md             # lazy pointer to installed box-docs/publishing.md
  NOTES.md              # optional shared scoped private notes; never deployed
_publish/abcdefghijklmnop2345672345/
  manifest.json
  releases/<content-hash>/...  # immutable generated files
```

**What:** Add named Cloudflare publishing connections to the existing authenticated admin Secrets area. Each connection stores account identity and a credential in machine secret custody; a signed-in global admin can validate, rotate, revoke, and grant it to a box for server-only use. The agent may request a connection or grant but cannot create, grant, inspect, or revoke it.

**Why this needs to change:** Current publish lifecycle resolves R2 writes from laptop Wrangler OAuth or environment credentials (`beebox/src/publish/lifecycle.ts:89-115`). That does not support box-member approval from the app or protect live manifest writes from an agent command.

**Direction:** Use the existing browser-pasted scoped API-token path first, adding explicit account verification and required R2/Worker write probes. Wrangler device login is a possible later simplification, but refresh-token custody and headless object writes are unverified. Show account id, credential type, verified capabilities, last verification, and per-box grants. A global admin grants a named connection to the box at `server` level. The server resolves it for agent-side provisioning and uploads while the publication is disabled. Revoking this grant blocks future service mutations but does not unpublish live sites; the admin UI must tell members to disable sites first while the connection is usable, or report disable unavailable after credential loss. Do not add mass-revoke machinery. Initial setup is a one-time browser task: an admin enrolls the Cloudflare account as required, pastes and verifies a scoped API token, and grants the named connection to the box. Thereafter the agent provisions the pinned Worker and uploads draft releases while disabled; an actual signed-in member of the box enables serving. Device/browser OAuth remains a later bounded feasibility test because refresh-token custody and required object-write authority are unverified.

**Vocabulary lock-ins:** `CloudflarePublishConnection`, connection name, per-box server grant. Reuse the secret store's global-admin-gated management surface and revocation patterns. Revoking a connection blocks future service mutations but does not unpublish live sites; while the credential still works, the admin UI instructs members to disable their sites first. If credential access is already lost, report that disable cannot be performed through this connection. No mass-revoke subsystem.

**First implementation chunk:** Add the strict credential-neutral connection record, global-admin-only store/verify/revoke API, masked admin editor, and secret-custody doctests. No Worker or site source changes in this chunk.

### Track B — Static site source

**What:** Accept a finished static folder copied as-is, or a declared source project built during prepare/upload/refresh. Source mode uses an ordinary site-local `package.json`, `pnpm-lock.yaml`, declared dependencies, and conventional `pnpm run build` producing `dist/`. Plain static mode needs none of these.

**Why this needs to change:** The existing renderer accepts a Markdown doc and emits one no-JavaScript HTML file (`beebox/src/publish/render-docs.ts:4-9,205-238`). The earlier view proposal copied card data into HTML and left review harder (`beebox/docs/plans/publish-pages.md:110-112`; scanner blind spot `beebox/src/publish/leak-scan.ts:31-41`). An authored site needs a clear, reviewable bundle boundary; any card data export should be intentional and positively selected.

**Direction:** A strict `publication.json` selects stable id, Cloudflare connection, tier, recipients, slug/title, and either static `site/` root or source `project/` root. The site package conventional build script declares its own entry and emits `dist/`. Output release path is server-derived. For project mode, prepare runs `pnpm install --frozen-lockfile` and `pnpm run build`; missing/stale lockfile or missing build script is a clear agent-facing setup error that tells the agent to update the site-local manifest/lock. The provided starter may use esbuild or Vite; project owners may choose another ordinary bundler through declared dependencies and the conventional build script. The bundler captures the declared JS/TS/JSX entry graph, CSS, and assets, and has no host React shim. Bare npm imports resolve from declared installed site dependencies; the bundler does not download them implicitly. Absolute HTTPS imports remain external, with no custom recursive CDN fetching, rewriting, or proxying. No arbitrary command field or general CI service. Upload/scan only validated `dist/` files; exclude package files, sources, `node_modules`, and secrets. Inline scripts are unsupported. Proposed published-site CSP (retain existing non-CSP security headers):

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

This permits direct HTTPS module imports, stylesheets, fonts, and images; ESM imports from bare package names bundle from installed declared dependencies. Keep eval/wasm execution disabled. Import maps are not required; if later supported, hash the generated map in CSP. This is not a confidentiality guarantee against authored code; arbitrary external data APIs remain a separate future decision. Direct imports reduce bundling work but depend on the remote provider for availability and allow that provider to observe requests; vendoring a pinned snapshot may help offline/deterministic use but is optional and is not inherently safer than package-based bundling. The app shows title, origin, audience, and emitted file/data summary; it never executes site JavaScript on the authenticated Bee Box origin. Local agent-browser evidence may be supplied. An interactive preview host is a future optional helper, not part of the core.
Project build scripts and optional export code run with the box's existing filesystem privileges; they are trusted authored code, not a sandbox, and can read or hard-code private data. Run install/build subprocesses with a minimal explicit environment (required `PATH`, task-scoped `HOME`/`TMPDIR`, and locale only); do not inherit server or agent credential environment variables. This is accidental-credential hygiene, not isolation from same-user code. The publisher runs only the standard project install/build contract, then scans/serves generated `dist/` files. The public Worker receives generated files only; it never runs Node/build code, reads cards, or calls back into the box. Bundle output excludes source files, `node_modules`, package files, and source maps by default. The leak scanner plus signed-in box-member review of source/text summaries remains required.

**Vocabulary lock-ins:** `PublicationDefinition`, static `site/` mode or site-local `project/` mode (`package.json`, `pnpm-lock.yaml`, conventional `pnpm run build` to `dist/`), `_publish/<pub-id>/releases/`. No custom dependency resolver or general CI service. Optional `writeJson`/`publishedUrlFor` helpers remain separate.

**First implementation chunk:** Verify static pass-through and source-project mode with a local fixture. Test frozen dependency installation, build output path validation, CSS/assets/module bundling, external URL pass-through, lockfile/script errors, and that only `dist/` reaches the release. Build and scan into staging; upload immutable release objects, then switch `activeRelease` only after every step succeeds. A failed, nonzero, or timed-out install/build/scan must not upload or promote a partial release, and the current page must remain live. Include starter compilation and scoped-note preservation/exclusion tests in the shipped authoring work. Optional JSON export retains a separate estimate, tests, and knowledge audits.

### Track C — Shipped authoring guide and optional starter; optional JSON export

**What:** Ship `beebox/docs/box/publishing.md` in the installed package's `box-docs/` and a lazy `src/publications/CLAUDE.md` pointer to `node_modules/beebox/box-docs/publishing.md`. The existing package docs generator ships `docs/box/` prose to that installed path and indexes docs with `read-when` metadata (`beebox/src/core/docs-gen/package-docs.ts:6,75-80,168`). Include copyable React/Tailwind starter recipe/files in the installed guide; when desired, the agent copies them into a site-local `project/`. No initialization command creates a site or copies a starter automatically. Static files and other standard project stacks remain supported. Keep strict JSON-export helpers as a separate optional follow-on.

**Why this needs to change:** Agents need a reusable golden path without making a framework mandatory or exposing Bee Box frontend internals as a published API. The guide also needs to preserve publication-specific knowledge without copying private notes into a release or coupling deploys across sites.

**Direction:** The starter is a conventional site-local React/Tailwind project with pinned own dependencies and its own content scan; no assumption that the Bee Box app's Tailwind config or components are importable. Start with a restrained neutral theme expressed through semantic CSS tokens, with accessible contrast and visible focus states, sensible typography/spacing, and responsive layout. Include local `SiteLayout`, `Header`, `Nav`, `Main`, `Footer`, `Button`, and `Card` components plus a simple homepage showing title, purpose, navigation, and featured content. Do not invent an automatic card listing or data. Keep starter components and theme under `project/src/`; `index.html` and `main.tsx` use the ordinary site build path. Bee Box frontend conventions are structural references only, not a branded color mandate or an importable component API (`beebox/frontend.md:105-150`). Do not add visual research or dependencies to define the neutral starter.

Add one optional box-owned plain-text notes file at shared `src/publications/NOTES.md`, scoped with readable `All sites`, `Site: <name>`, and `Path: <site>/<relative-path>` headings. Path examples include `<site>/site/<subdir>` for static mode and `<site>/project/src/<subdir>` for project mode. The shipped lazy guide directs agents to read and update notes when authoring, preserve them through initialization, and promote reusable lessons into `All sites` rather than propagating site-specific details. No parser, custom dependency, or shared cross-site deployment behavior; notes never enter published files. Update `beebox/docs/box-layout.md` and root vocabulary guidance because publication source is a new authored box area (the current layout list says “No app code,” `beebox/docs/box-layout.md:249-256`). Follow the lazy nested-guide precedent in `beebox/src/core/box/templates.ts:218-237,265-275`.

The starter files and guide are shipped; adopting them is optional. Strict JSON export remains optional: it uses the existing card reader with explicit field selection, constructs public objects field by field, and validates strict Zod output schemas. A helper `publishedUrlFor(ref)` may map a resolved ref only to a route explicitly emitted within the same publication; never publish raw refs or a ref map. Missing or un-emitted targets produce a clear error unless the author deliberately projects display text. Automatic private-ref mapping to another publication is deferred because it can leak audience/capability; bespoke HTML may contain ordinary explicit public hyperlinks under existing leak/link policy. Project bundlers may bundle declared local dependencies or preserve explicit external HTTPS ESM imports. No host-app shim. Version pins improve reproducibility but do not cryptographically freeze the full dependency graph.

**Vocabulary lock-ins:** human-readable notes only; no notes parser, projection DSL, new card schema, app component package, or custom dependency resolver. `writeJson(path, strictSchema, value)` and `publishedUrlFor(ref)` remain optional helpers.

**First implementation chunk:** Ship the copyable starter/guide through the existing installed `box-docs/` packaging path, and verify that initialization preserves shared scoped notes and that the publisher excludes them. Knowledge audits confirm agents find the lazy guide and notes, apply only relevant scope headings, recognize starter adoption as optional, and preserve the positive export boundary. Test the guide's starter fixture compilation and content scan without importing app internals. Strict JSON export stays a separately estimated/tested/audited optional chunk; test extra-field rejection, private-field omission, unresolved refs, path escapes, and no raw ref keys only if selected.

### Track D — Isolated per-publication Worker origins and bundle policy

**What:** Deploy existing Worker source once per publication at a distinct `workers.dev` host. Assign a random non-capability `hostHandle`, separate from the secret `PubId`; bind the Worker immutably to the `PubId`. The host never authorizes secret content. Keep secret capability only in the established `/s/<PubId>/` path; a host-root request must not disclose or redirect to a secret path.

**Why this needs to change:** The existing plan states “secrecy lives only in the ≥128-bit pub-id path segment, never in the hostname” (`beebox/docs/plans/publish-pages.md:57`). Public Workers hostnames are enumerable, so they cannot carry secret capability. Per-publication origins also isolate same-origin page code from other publication paths.

**Direction:** Assign a random host handle for the per-publication Worker script/hostname, retaining the per-box R2 content bucket. Do not derive host or script name from secret `PubId`. Bind each deployed Worker to one `PubId` in server-controlled deployment metadata. The human confirmed that this resource policy applies only to published sites; other authored JavaScript surfaces are out of scope. Allow external HTTPS scripts/modules, stylesheets, fonts, and images; do not maintain a fixed CDN allowlist. Keep `connect-src 'self'` as the default for same-origin JSON; external data APIs are a separate future policy decision. This CSP is not a confidentiality guarantee: approved scripts can communicate through other browser mechanisms. Keep inline scripts/eval blocked. Add `Cross-Origin-Resource-Policy: same-origin` to every published response and no permissive CORS, `nosniff`, and `no-referrer`; this blocks another origin from embedding protected classic scripts while permitting CORS-enabled HTTPS module imports. Direct URL imports need no inline import map; if an import map is later supported, cover it with a CSP hash. Test both classic-script embedding and credentialed CORS fetch from another publication while the viewer is logged into and authorized for the target. Serve `.html`, `.js`, `.css`, `.json`, and assets with explicit MIME types and `nosniff`. Check requested paths against `manifest.files` before R2 access. Reject all cross-pub ids, host/path fallback, source maps, and unlisted files. Enforce account Worker quota before deployment and show a clear capacity error (100 Workers Free / 500 Paid, subject to current account quota). Do not attempt wildcard/custom-domain hosting in v1. Define a mount-relative static-site contract: supported documents/assets only, no arbitrary server routes or app-absolute URLs. Store `activeRelease` and immutable release inventory in the edge manifest. The stable entry URL checks current enablement/audience, then redirects documents to a release-qualified URL; mount-relative CSS/JS/JSON/assets resolve within that release. Every release request checks live enablement and current audience before serving. Retain the active plus one previous release for at most 10 minutes on same-scope refreshes; an audience/destination approval drops old-release reachability. Disable gates every release. Remove unreachable artifacts during the same serialized mutation cleanup, with no daemon.

**Account tiers:** Keep `accounts` and `any-account` as optional tiers, but do not use the ordinary content credential for Access administration. They are not ready until Access setup authority and each isolated hostname are verified with a browser E2E for login, JWT audience, cookie isolation, and recipient checks. Readiness stays false on API errors or unknown response shapes. Preserve the existing Access tier code and old live publications; do not silently remove them. Existing publications stay on their current Worker until a signed-in member of that box migrates or disables them. Do not enable self-fetch on that legacy shared host.

**Vocabulary lock-ins:** Worker deployment includes immutable `PUB_ID`; R2 key access is limited to `pubs/<PUB_ID>/...`; `manifest.files` is an allowlist. One Worker hostname equals one publication origin.

**First implementation chunk:** Add random hostHandle assignment and immutable PubId binding, reenableable `disabled` edge status distinct from terminal `revoked`, `activeRelease` plus immutable release inventory, release-qualified URLs, request-time live audience/enablement checks, and per-release file allowlists. Tests trace an old HTML page loading its own JS/CSS after a new release and verify prior-release expiry, scope-change invalidation, disable, and cross-PubId rejection. Only then adjust CSP for optional JSON loading.

### Track E — Box-member enable/disable, refresh and audience approval

**What:** Add a per-publication review surface to the signed-in app. Agents may fully configure a publication while it is disabled: the server grants the box service authority to provision its pinned Worker and upload draft releases, while the Worker serves none of them until a signed-in box member enables the publication. Any signed-in member of the owning box enables/disables that publication and approves scope changes. This box-level action is distinct from global admin authority over Cloudflare connections and grants. Existing CLI build tools may remain as agent tools, but no CLI path writes approved edge state.

**Why this needs to change:** `bbx pub go` currently performs the human flip in a TTY (`beebox/src/publish/go.ts:134-138`), but the boxholder cannot use the CLI. The current R2 manifest is the serving authority (`beebox/src/publish/manifest-edge.ts:14-20`), and it must not be writable by agent-configured fields.

**Direction:** The per-box member UI lists title, origin, audience, emitted file/data summary, requested tier/recipients/destination, and approved live scope. It does not execute site JavaScript; source and text may be inspected safely. Enable changes serving state in the existing edge manifest; provisioning and draft upload have already happened agent-side while disabled. Disable writes an edge tombstone/disabled state first and verifies the resulting state before displaying “disabled.” Failed writes or verification remain visibly pending/failed; never show disabled while the page may still serve. Route enable, refresh, scope approval, and disable through one server-mediated serialized per-publication mutation path; add no queue or daemon. Keep the state machine distinct: `disabled` can be re-enabled by a box member, while `revoked` is terminal under current behavior. A disabled publication may still be configured and have draft releases uploaded, but those files never become reachable until a signed-in box member enables it. An agent cannot change enablement or approved audience/destination; it may advance content within an enabled publication. Successful live content refresh switches to an immutable release under the approved scope. Any change to audience or destination, including narrowing or a slug/host change, blocks activation under the old request until a signed-in member of that box approves the new scope. After initial browser enrollment and box-member enablement, agents may refresh approved content without the human present.

A signed-in box member action and server-side connection write are the actual controls. Reuse box membership checks (`beebox/src/webapp/trpc/trpc.ts:40-82`; `beebox/src/webapp/box-access.ts:16-34`); do not add a new per-publication role. Reject anonymous, auth-disabled, and CLI/agent contexts for enable, disable, or audience approval. Global admins manage connections and grants. Publication approval requires signed-in membership of the owning box, not global administration. The existing TTY prompt is not a substitute. This moves the existing laptop-only content/deploy credentials into machine server custody, reversing the earlier decision to keep publish keys outside the box (`beebox/docs/plans/publish-pages.md:147`). This grants authority across the normal app/agent API boundary; it does not defend against hostile code running as the same OS user or compromising the box server (`beebox/docs/implemented-plans/secret-custody.md:47-59,109-121`). It is a deliberate host-trust tradeoff for human-free agent configuration, not a sandbox or cryptographic human gate. Keep Access administration separate from ordinary content credentials; static-site runtime does not require token-mint authority.

**Vocabulary lock-ins:** agent-requested definition vs box-member-approved edge scope; `enabled` vs disabled state; pending audience change. Do not add a separate database for approval state.

**First implementation chunk:** Add any-signed-in-box-member enable/disable for a preprovisioned disabled fixture. Verify agent provisioning works while disabled, but cannot make it serve; enable switches the edge state, and disable gates all release URLs.

## Could this be simpler?

One Worker per box is smaller, but authored JavaScript on a shared origin could request account-tier paths from a public page. Keeping `connect-src 'none'` blocks fetch but does not remove the need to isolate same-origin script/image/navigation access. One Worker per publication makes each public document, secret link, and Access session a separate origin, per Cloudflare's documented per-Worker hostname shape. The boxholder approved the account quota and per-site deploy cost for v1; an operator-managed shared service would require a new multi-tenant dispatch model. Direct HTTPS dependencies are simpler than an own-origin runtime proxy, which would need upstream resolution (including transitive imports), caching, and another service to operate. The build may bundle declared installed packages; direct HTTPS imports remain external by default. Optional vendoring of selected external files can provide frozen bytes, offline use, or avoid third-party viewer requests, but should not block direct imports. Neither local npm bundling nor CDN imports are inherently safer; recommend exact versioned URLs for reproducibility without claiming the full graph is frozen.

## Subplans

None. If approved, this sibling plan supersedes the conflicting view-snapshot and CLI approval tracks in `beebox/docs/plans/publish-pages.md`; it does not supersede unrelated submission, docs, or knowledge-audit work. The missing view-snapshot subplan is superseded by this static-site direction. Cloudflare's exact Access API behavior remains a live-validation gate in Track D, not a separate research-only prerequisite.

## Failure modes

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Extra/private card field reaches optional JSON | Planned strict-export doctest | `.strict()` output schema and field-by-field construction reject it | Clear build error; semantic privacy still requires review |
| Ref is stale, private, or not emitted in optional export | Planned ref-map doctest | canonical contained resolver + explicit route map; fail unless projected to display text | Clear with source ref named |
| Authored code reads private data or hard-codes secrets | No automated test can prove intent | Existing privileges are unchanged; leak scan + box-member preview | Residual judgment risk, stated plainly |
| Build writes unknown path/source map or malformed file | Planned bundle-policy doctest | fixed output root, path validation, manifest path allowlist | Clear build rejection |
| Install/build/scan fails, exits nonzero, or times out | Planned project-mode failure test | Stage locally; do not upload/promote until all steps pass; switch `activeRelease` last | Clear failure; current release stays live |
| Worker serves an unlisted or other-publication path | Planned Worker test | pin `PUB_ID`; manifest file check before R2 read | Clear 404; cross-pub reads impossible through Worker |
| Cross-origin page embeds protected classic JS or reads it by CORS | Browser test from a second publication with viewer authorized to target | CORP same-origin; no permissive ACAO; external module imports require provider CORS | Browser blocks cross-origin embedding/read |
| Public JS reads an Access page on another publication host | Browser test with a viewer logged in and authorized for the target Access page | Random host handle; PubId secret stays in path; per-publication origin | Clear prevention if isolation proof passes |
| Access API creates wrong app/audience or cookie scope | Fake API tests plus live browser E2E | Read back app/audience and keep capability “not ready” until verified | Clear setup failure; no accounts-tier enable |
| Worker quota exhausted | Provisioning client test | Count/read API if available; otherwise handle CF quota response | Clear box-member-facing capacity message; no enabled state |
| Old page loads new-release assets across a refresh | Worker browser trace test | Release-qualified document URLs; active plus one previous release for 10 minutes on same scope | Clear; old release then expires |
| Audience change exposes old release | Manifest transition test | Drop previous-release reachability when scope changes; recheck live audience on every request | Clear denial |
| Box-member disable races refresh | Concurrency doctest | Serialize manifest updates; disabled state gates all releases | Clear refusal; disabled wins |
| Agent points Box A at another box's bucket, Worker, or publication id | Cross-box API/definition doctest | Derive owning box, bucket, Worker name, and PubId binding server-side; definition may select only an explicitly granted connection and desired content/audience | Clear rejection; no cross-box credential routing |
| Box-member disable write fails | Failure-path test | Do not report disabled until edge state is confirmed; keep visible failure | Clear, page may remain live until retry succeeds |
| Requested audience differs from approved audience | tRPC/CLI contract test | Reject update and hold old edge scope pending signed-in box-member action | Clear “approval required”; old audience remains active |
| Old publication appears deleted during migration | Migration test with legacy Worker fixtures | Leave current Worker and live manifests untouched until a box member migrates | Clear; old URL remains live |

> **Accepted host-trust risk:** moving content-write and Worker-deploy credentials from laptop-only custody into machine server custody is the explicit cost of letting an agent fully configure publication without CLI work from the human. UI authorization protects the normal app/agent API boundary; hostile same-user code or box-server compromise can exercise that server authority. This plan adds no sandbox and does not claim a cryptographic human gate. Keep Access administration separate and account-tier serving disabled until its live browser proof passes. Report failed mutations visibly; do not claim state changed until edge authority confirms it.

## Agent-flow / user-flow edge cases

- **Wrong field/tier:** ADDRESSED — strict definition and per-tier manifest parsing reject invalid fields; app shows requested and approved tier before signed-in box-member action.
- **Stale ref:** ADDRESSED — canonical resolver checks containment and the emitted-route map; unresolved target is a build error.
- **Concurrent agent update and box-member disable:** ADDRESSED — one serialized edge-manifest write; disabled state rejects content refresh.
- **Hand-edit drift:** ADDRESSED — source definition and generated manifests use strict schemas; server revalidates every upload.
- **Fabricated value:** PARTIALLY ADDRESSED — exports construct values, but trusted build code can lie or read private information. Leak scan is a backstop; a signed-in box member reviews the file/data summary and source.
- **Validation UX:** ADDRESSED — errors name file, output field, ref, or requested-vs-approved scope.
- **Partial migration:** ADDRESSED — old per-box Workers and active URLs remain until a box member migrates/disables each publication; new deployments use separate names/hosts.
- **Audience changes:** ADDRESSED — all changes, including narrowing, require fresh box-member approval; existing approved scope remains in force until approval.

## NOT in scope

- Submission forms and pull connector: they are not needed to serve a site and the form-producing path is absent (`issues/bugs/2026-08-21-published-pages-can-never-carry-a-submit-form-nothing-s.md`).
- Automatic mapping of a private box ref to another publication's URL: it can reveal that publication's capability or audience, so v1 maps refs only to explicitly emitted routes in the same site. Bespoke HTML may still contain ordinary explicit public hyperlinks; the existing link/leak scan policy continues to apply.
- Live card/API access from the Worker: published pages are generated snapshots and never call into the box.
- Custom domains, wildcard Workers Routes, Workers for Platforms, shared multi-tenant buckets, and public hub serving: these add ownership/routing surfaces beyond one publication Worker.
- A hostile-code sandbox: authored project build scripts run with existing box privileges; isolation is at the publication-serving origin, not at build time. Arbitrary external data APIs are a separate future policy question.
- Automatic migration or deletion of current live publications: signed-in box members decide whether to move or disable them.
- Removing existing public/secret/account-tier support: old Workers keep serving current publications; new account-tier publication requires verified isolated Access setup.

## Open design questions

- **Per-publication Worker budget:** resolved — the boxholder approved one Worker per publication as the domain-free isolation baseline on 2026-09-24, within Cloudflare's 100 Free / 500 Paid limits and per-site deploy cost. Keep capacity exhaustion visible; do not substitute shared multi-tenant dispatch in v1.
- **Cloudflare connection scope:** content credentials cover only needed R2 writes and Worker deploys. Access provisioning uses a separate admin setup credential; static-site runtime never receives Access-admin or token-mint authority. Exact API scopes remain a live setup question.
- **Access hostname setup:** can the current Access API create and read back one app/audience per `workers.dev` publication host with correct cookie isolation? Unknown until a real browser/account pass. Keep accounts tier “not ready” until proven.
- **Per-box vs operator-owned Cloudflare account:** admin connection supports either. Lean: do not force shared ownership; per-box content buckets and Workers remain isolated even under an operator account.
- **Scope of external-resource policy:** resolved by the human — the policy applies to published sites only. Other authored JavaScript surfaces are out of scope.

## Knowledge audits

Core audits cover signed-in box-member publication enablement and agent refresh vs audience approval. The optional JSON helper track adds separate audits for positive field selection and safe same-publication ref mapping. External HTTPS dependencies are trusted author choices, not a confidentiality guarantee; do not add an “no external fetch” rule.

## What will hold this after it ships

- Core tests cover static pass-through and project mode, lockfile/build failures, module/CSS/asset bundling, dist-only publication, audience preservation, and manifest/release ordering. Optional JSON helper tests separately cover strict schemas, positive field selection, ref resolution, and emitted-route mapping.
- `pub-worker` vitest-pool-workers tests cover pinned publication id, manifest-listed assets, MIME types, tier fail-closed behavior, and all headers, including CORP and no permissive CORS.
- The admin API/UI test tier covers global admin connection/grant custody and signed-in box-member vs agent/anonymous enable/disable and audience approval; it also covers quota/API errors and visible pending failures.
- A real browser pass proves stable entry URLs redirect to release-qualified files, same-release relative assets keep working across refresh, disabled status gates every release, and a viewer logged in and authorized for an account-tier publication cannot read or classic-script-embed it from another publication origin. Shipped starter tests cover conventional project compilation and scoped-note preservation/exclusion; optional JSON tests remain separate. Project mode also verifies CORS-enabled external ESM imports. Tests with mocked Cloudflare APIs do not prove Access cookie scope or account quotas.

## Implementation order

1. Admin Cloudflare connection and per-box server-only grant.
2. Static mode pass-through plus site-local project mode (`package.json`/`pnpm-lock.yaml` and conventional `pnpm run build` to `dist/`); provide an esbuild/Vite starter while allowing projects to choose a declared bundler.
3. Worker hostHandle/PubId binding, disabled status, release pointer/inventory, release-qualified URLs, live request checks, file allowlist, and CSP/CORP/CORS tests.
4. Agent prepares/builds the project, provisions the Worker, and uploads draft releases while disabled; the shipped guide/starter and scoped notes are available during authoring.
5. Box-member enable/disable UI and server-mediated content refresh under approved scope; Enable only changes serving authority because the agent already configured the disabled publication.
6. Optional JSON export helper track with its separate estimate and audits.
7. Optional per-publication Access provisioning and browser verification; only then mark account-tier capability ready.
8. Migrate a single box-member-selected existing publication without changing its old URL until the new URL is verified; document migration and leave all other live publications alone.
9. Public reference docs, box-agent guidance, and run the core knowledge audits.

Each chunk may be committed in the worktree, but the feature ships as a unit only when the boxholder asks. Initial Cloudflare enrollment and live validation require a human browser session. After an admin grants the connection, the agent provisions and configures the disabled publication; a signed-in box member enables serving. Later approved content refreshes run agent-side. No credentials or live calls are part of this planning work.

## Rollout shape

Start with static pass-through tests, then project-mode tests using a site-local locked dependency and conventional build script. Confirm the bundle includes imported JS/CSS/assets, supports explicit external HTTPS imports, and publishes only `dist/`; inspect source/text and use the agent's local browser preview if available. Do not execute site JS on the Bee Box app origin. Separately test optional export with a selected card whose private fields are omitted; the JSON must show only selected fields. Unknown output fields, unresolved refs, path escapes, and invalid MIME fail clearly. Leak-scan all emitted text; preview every file, including binary assets.

Next, an admin completes one-time browser enrollment and grants the connection. Agent provisions the random hostHandle Worker and uploads a disabled release. Confirm the hostname reveals no PubId, host root does not redirect to `/s/<PubId>/`, the pinned Worker rejects other PubIds, release-relative assets stay on the intended version, and disabled status gates all versions. For Access, confirm app `aud`, organization/OTP setup, cookie scope, login, and allowlist with a real browser before marking the feature ready. No CLI action may enable a page.

End-to-end completion: agent supplies static files or authors a JS/TS/JSX site project, optionally adopting the shipped React/Tailwind starter or adding explicit JSON export; signed-in box member sees the exact audience/destination and output in the app, enables it, and opens the unique URL; agent updates content and the page changes under the same approved audience; an audience change is held until signed-in box member approves; signed-in box member disables it and the edge manifest/URL reports the disabled state; failures stay visible. Existing live publications continue serving until individually migrated or disabled by a signed-in member of that box. Run the named doctests, Worker suite, admin UI/API checks, security report update, and docs check. Run core knowledge audits, including whether agents find/use scoped notes; run JSON-helper audits only if that optional helper track is selected. Record live Cloudflare/browser evidence separately from fake-backed tests.
