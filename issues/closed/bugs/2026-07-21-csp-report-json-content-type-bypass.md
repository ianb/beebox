---
title: "CSP report body bound is bypassed by application/json content-type"
workstream: open-source-readiness
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
labels: [soft-launch]
resolution: implemented
---

**RESOLVED (implemented).** Fixed in `src/webapp/routes/api-csp-report.ts` by
adding a per-route `{ bodyLimit: MAX_REPORT_BODY_BYTES }` (16 KB) to the
`POST /api/csp-report` handler. The route bodyLimit bounds the RAW body for
every content-type, so an `application/json` (or any other) POST is 413'd above
16 KB instead of falling through to Fastify's default parser under the
server-wide 50 MB limit. The global JSON limit other routes need is untouched.
Test added in `test/webapp/routes/api-csp-report-bounds.doctest.md`: an oversized
`application/json` body → 413, nothing logged.

---

**MED-HIGH. The overnight CSP fix
([csp-report-endpoint-memory-exhaustion](2026-07-19-csp-report-endpoint-memory-exhaustion.md))
is incomplete.** Found by Codex (2026-07-21), verified.

The 16 KiB body limit is attached only to the dedicated parser for
`application/csp-report` + `application/reports+json`
(`src/webapp/routes/api-csp-report.ts:107-109`). But the route
`POST /api/csp-report` (`:141`) accepts **any** content-type. Send the same
payload as `Content-Type: application/json` and Fastify's default JSON parser
handles it under the server-wide 50 MiB limit (`server.ts:55`) — the
unauthenticated memory-allocation vector the fix targeted is still open. The
field-truncation + 20-report cap still bound *disk* writes, so the residual
risk is memory/CPU on parse, not log amplification. (Chunked bodies and
nested arrays do NOT bypass — only the content-type does.)

Fix: a per-route `bodyLimit` on the POST (`server.post(path, { bodyLimit:
MAX_REPORT_BODY_BYTES }, handler)`) bounds the raw body regardless of
content-type, without touching the global JSON limit other routes need. Add a
test sending an oversized `application/json` body → 413.
