---
title: "Dev router static asset prefixes also admit nested box routes"
workstream: chat-scroll-fixes
resolution: implemented
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — reviewing the audio unlock asset exception
---

Implemented by `228830414` and landed on main in `16eae8850`. Public static
access is limited to direct filenames, and the router shares Vite's canonical
identity matcher. Deployment completion and shared-router activation remain
unverified; verification used synthetic credentials and no real box content.

The dev router's public static asset classifier accepts every GET below the
`assets` and `icons` path prefixes. These names are also valid box slugs.
Vite's per-box API and auth proxy rules take precedence over static file
lookup. A nested API or auth request below either prefix therefore passes
the router's outer credential gate and can reach the hub's box routing.

This is an outer-gate classification mismatch, not evidence that private
box data can be read. The hub and box child retain their own auth checks.
No real box content or credentials were accessed to verify this finding.

## Research (2026-10-05)

- `workstreams-app/src/router/server/auth.ts`: `isPublicFrontendAssetPath`
  accepts arbitrary descendants of `/assets/` and `/icons/`;
  `classifyWorktreePrefix` admits them as `unauth-allowlist` for GET.
- `beebox/src/frontend/vite.config.ts`: the proxy rules match per-box
  `/api/` and `/auth/` routes before Vite's static middleware.
- `beebox/src/hub/config.ts`: `RESERVED_SLUGS` contains `healthz`, `auth`,
  `webhook`, and `api`. It does not reserve the static asset prefix names.
- `workstreams-app/src/router/server/proxy.ts`: `proxyWithRetry` forwards
  authorized paths to Vite without restricting the static asset route class
  to static files. It strips client identity headers; it does not substitute
  an authenticated identity for this class.

The audio unlock fix adds only direct earcon media filenames to the public
asset classifier. It leaves nested paths, encoded separators, and box API
and auth routes behind the existing credential gate.

## Fix and verification (2026-10-05)

The static classifier now admits only direct unescaped filenames below
`assets` and `icons`. It does not impose an extension inventory. Nested
paths, directory roots, dot segments, backslashes, and percent escapes use
the box credential gate. The existing GET-only public-asset policy is
unchanged. The `assets` box's direct `icon-<digits>.png` and
`manifest.webmanifest` paths also use box auth because Vite proxies those
identity assets to the backend. Its identity-asset proxy explicitly excludes
the shared `icons` directory.

The identity matcher now lives in
`beebox/src/shared/box-identity-asset-routes.ts`. The router's identity guard
and Vite's proxy pattern derive from one literal regular expression. This
prevents a future identity route from drifting between the two boundaries.

An isolated real router used the repository's Vite configuration and the
installed frontend Vite version. Its backend answered only synthetic
fixtures for hypothetical `assets` and `icons` boxes. Before the patch,
uncredentialed nested API/auth and `assets` identity requests returned 200
and reached that backend. Raw and encoded dot-segment requests also reached
it after downstream normalization. After the patch, those requests returned
401 without reaching the backend. Valid synthetic box-session credentials
still reached all four API/auth and identity fixture handlers.

JavaScript, CSS, font, icon, and earcon requests returned 200 with their
correct media types and did not reach the synthetic backend. Uncredentialed
HEAD and POST requests retained their existing 401 behavior. A real Chromium
browser independently confirmed public asset loading and protected-route
401s through the isolated router. All 21 files in the current main frontend
build and all three shared public icons match the new filename rule.

The focused auth suite passed 34 tests, including root/prefix near-misses,
raw/encoded normalization, hypothetical box credentials, and static asset
formats. Scoped source and test ESLint checks passed. The regression failed
against the original classifier before applying the fix.

The shared router was not restarted, and no real box content or credentials
were accessed. Runtime verification used controlled synthetic auth resolvers
and backend responses; it does not establish a private-data leak through the
independent hub and child auth walls. The router needs the usual main merge
and operator restart before this change is live.

A scoped security-report amendment was prepared separately for human review.
The tracked report and overview remain unchanged. The proposed amendment
adds the missing dev-router static-file row without changing the production
hub's existing public-static assertion. The security-report skill's auth
surface map now includes the dev-router server modules.
