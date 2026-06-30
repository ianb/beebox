# Scheduled routine: CSP violation review

A recurring routine that reviews production Content-Security-Policy violations
and decides whether the policy is safe to harden. The webapp ships its CSP as
**Report-Only** (it reports violations but blocks nothing — see
`docs/content-security-policy.md`); this routine accumulates confidence over real
traffic and proposes the flip to enforcing once the reports are clean.

**The scheduled task prompt can be one line:** *"Follow the instructions in
`callback-box/docs/scheduled/csp-violation-review.md`."* Everything it needs is
below.

## Cadence

Weekly is appropriate — violations accumulate slowly and the Report-Only window
is measured in weeks. Suggested cron: `0 14 * * 1` (Mondays 14:00). Run it as a
fresh-session-per-fire routine; it needs no prior conversation context.

## Prerequisite: prod log access

Reports are written by the `/api/csp-report` sink to the **primary box** on the
prod server at `/home/callback/boxes/<box>/.callback-box/csp-reports.log`. The
routine reaches it by SSH (the same access the deploy uses):
`ssh root@$(cat callback-box/deploy/server-ip)`. If the routine's environment
cannot SSH to prod, stop and ask the boxholder — the alternative is a diagnostic
GET endpoint to fetch the log over HTTPS, which is not built yet.

## Steps

Run from the `callback-mono` repo root.

1. **Pull the prod report log** (the sink writes it under whichever box is
   primary, so glob across boxes):
   ```bash
   ssh root@$(cat callback-box/deploy/server-ip) \
     "cat /home/callback/boxes/*/.callback-box/csp-reports.log 2>/dev/null" \
     > /tmp/csp-prod.log
   ```
   Empty output means no reports yet — that is a *clean* result, not an error.

2. **Digest it:**
   ```bash
   cd callback-box && pnpm csp-digest /tmp/csp-prod.log
   ```
   The digest dedupes by directive+origin with counts and a first/last-seen
   window, and prints either a violation list or "Safe to harden."

3. **Act on the digest** — and keep the report short (a digest + a
   recommendation, not a wall of text):

   - **Clean** (no violations across meaningful real traffic — chat with images,
     dictation/realtime voice, a p5 figure, a logged-in Google avatar):
     **propose hardening.** In `callback-box/src/webapp/server-root.ts`
     `registerCspReportingHeaders`, the flip is changing the header name from
     `Content-Security-Policy-Report-Only` to `Content-Security-Policy` (keep
     `script-src 'self'`). **Propose only — do not edit or deploy without the
     boxholder's confirmation.** This routine arranges the context; a human makes
     the call.

   - **Violations present:** list each (`directive ← blocked-origin`, with
     counts). For each, judge:
     - a **legitimate** browser consumer (a new external image host, API, or
       embed origin) → recommend the specific allowlist edit in
       `callback-box/src/lib/csp.ts` (and its `test/lib/csp.doctest.md` update);
     - a **real bug or unexpected exfiltration** → flag it for investigation.
     Do **not** harden while any violation is unresolved.

     One known, expected case: a figure using p5's opt-in `eval`/WASM features
     (Strands shaders, JS filter shaders, HarfBuzz 3D-text) would report a
     `script-src` violation. The right fix is to iframe-isolate that figure, not
     to add `'unsafe-eval'` app-wide. See `docs/content-security-policy.md`.

## Background

`docs/content-security-policy.md` (how the policy is defined and wired) and
`docs/implemented-plans/app-wide-csp.md` (the design rationale, including why the
rollout is Report-Only-first and the hardening is gated on this routine).
