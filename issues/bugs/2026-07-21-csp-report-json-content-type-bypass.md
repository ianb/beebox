---
title: "CSP report body bound is bypassed by application/json content-type"
area: callback-box
filed-by: agent
discovered-in: worktree-open-source-readiness — Codex review of the overnight security fixes
---

**MED-HIGH. The overnight CSP fix
([csp-report-endpoint-memory-exhaustion](../closed/bugs/2026-07-19-csp-report-endpoint-memory-exhaustion.md))
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
