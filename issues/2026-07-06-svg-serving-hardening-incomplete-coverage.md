---
needs: [design]
area: callback-box
filed-by: agent
discovered-in: worktree-architectural-review — Track D.1 (P2-c), codex review
---

# Dangerous-renderable serving hardening only covers `/api/files/*`

Track D.1 hardened `/api/files/*` so `.html`/`.svg`/etc. default to
`Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`
(`src/webapp/routes/api-files.ts`). Codex's review of that change found two
sibling raw-file routes that serve the same box content but weren't in
scope and still serve `.svg` inline with neither header:

- `src/webapp/routes/api-image.ts:22,153` — treats `.svg` as an image type
  and serves it as `image/svg+xml` with no disposition/nosniff.
- `src/webapp/routes/history.ts:11,64` — the committed-blob route serves a
  historical `.svg` the same way.

Since an SVG document can carry a `<script>` that executes when the browser
renders it as a document (not just rasterizes it), these are the same
stored-XSS shape as the `/api/files/*` finding, reachable by requesting the
same file through `/api/image/*` or `/api/history/blob/:hash/*.svg` instead.

Worth a small audit: enumerate every route that serves raw box/git-blob
bytes by extension-inferred MIME type, and decide whether the
`DANGEROUS_RENDERABLE_EXTENSIONS` set + header logic in `api-files.ts`
should become a shared helper all of them call, rather than each route
re-deciding trust independently.
