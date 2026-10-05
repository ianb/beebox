---
title: "Dev router static asset prefixes also admit nested box routes"
workstream: unattached
area: router
filed-by: agent
discovered-by: agent
discovered-in: worktree-chat-scroll-fixes — reviewing the audio unlock asset exception
---

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
and auth routes behind the existing credential gate. Resolve the older
`assets` and `icons` mismatch in a separate change, with routing and auth
coverage for both real static files and hypothetical colliding box slugs.
Reconcile the security report's dev-router auth inventory during that work;
the new bounded earcon exception does not change the existing public static
earcon assertion.
