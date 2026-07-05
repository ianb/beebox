# Scheduled routine: CSP violation review

A recurring **local** routine that reviews Content-Security-Policy violations as
they accrue during development and decides whether the policy is safe to harden.
The webapp ships its CSP as **Report-Only** (it reports violations but blocks
nothing — see `docs/content-security-policy.md`); this routine watches real
local traffic, surfaces anything new, and proposes the flip to enforcing once
the reports are clean.

**The scheduled task prompt can be one line:** *"Follow the instructions in
`callback-box/docs/scheduled/csp-violation-review.md`."* Everything it needs is
below.

## Where this runs

This is a **local** routine — it reads the CSP log the local dev server writes,
not prod. The `/api/csp-report` sink appends violations (as JSONL) to the primary
box at `~/src/boxes/test1/content/.callback-box/csp-reports.log` as you exercise the app
locally. The routine must therefore run **on the machine where that box lives** (e.g. a
local `/schedule` task), not in a cloud environment that doesn't have the box. There is
no SSH or HTTPS log-fetch step — it reads the file directly.

## Cadence

Daily is reasonable for local review while the Report-Only window is open; the
digest is incremental, so each run only surfaces what's new since the last one.
Run it as a fresh-session-per-fire routine; it needs no prior conversation
context.

## Steps

Run from the `callback-box/` directory.

1. **Digest the new violations since the last run:**
   ```bash
   pnpm csp-digest --box ~/src/boxes/test1/content
   ```
   (`--box` is required for now — the command's own default still points at
   `~/src/boxes/test1`, the pre-v2 package root, not its `content/` subdirectory.)
   This reads the local primary box's log, prints only entries newer than the
   last run, and advances a timestamp cursor (in the git-ignored
   `.callback-box/csp-digest-cursor.json`) so the next run resumes after them. No
   output / "No new CSP violations" means nothing new since last time — a *clean*
   result, not an error. (Add `--json` if you want the digest structured for
   analysis.)

2. **Analyze what's new.** The incremental digest is the delta. For the harden
   decision you need the whole-log picture, so when the delta is clean (or you're
   about to recommend hardening) also run:
   ```bash
   pnpm csp-digest --all
   ```
   which digests the entire log without touching the cursor.

3. **Act on the digest** — keep the report short (a digest + a recommendation,
   not a wall of text):

   - **Clean** (no violations in `--all` across meaningful real traffic — chat
     with images, dictation/realtime voice, a p5 figure, a logged-in Google
     avatar): **propose hardening.** In
     `callback-box/src/webapp/server-root.ts` `registerCspReportingHeaders`, the
     flip is changing the header name from `Content-Security-Policy-Report-Only`
     to `Content-Security-Policy` (keep `script-src 'self'`). **Propose only — do
     not edit or deploy without the boxholder's confirmation.** This routine
     arranges the context; a human makes the call.

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

4. **Report to the boxholder.** On a scheduled run there's no interactive human
   in the loop, so deliver the result: email the boxholder a short note via the
   Gmail tool — the digest summary and your recommendation (propose-harden / list
   of new violations + suggested edits / flag for investigation), not a wall of
   text. For now report on **every** run so the boxholder can see the routine is
   working end-to-end; once it's trusted this can switch to quiet-when-clean
   (skip the email when the delta is clean). The "propose only — don't edit or
   deploy without confirmation" rule still holds: the report proposes, the human
   decides.

## Background

`docs/content-security-policy.md` (how the policy is defined and wired) and
`docs/implemented-plans/app-wide-csp.md` (the design rationale, including why the
rollout is Report-Only-first and the hardening is gated on this routine).
