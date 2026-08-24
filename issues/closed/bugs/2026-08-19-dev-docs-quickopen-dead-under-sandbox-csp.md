---
title: "Doc browser's Cmd-P quick-open is dead under the /dev sandbox CSP"
workstream: workstream-story
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstream-story — a blocked-script console error while viewing a dev/ page
resolution: superseded
---
> **Closed as moot, 2026-08-24.** The surface this issue describes no longer
> exists: commit `46b03219` retired the `/dev/docs/` doc browser, and
> `/<w>/dev/docs/...` is now a 301 to `/workstreams/browse?file=…`. There is
> nothing left to manual-test here — see "Superseded" at the bottom.

The `/dev/docs/` doc browser ships its quick-open palette as an inline
`<script>` (`bin/router-docs.ts` `renderDocQuickOpen`, included on every doc
browser page). The B.2c hardening (commit `dd3cc9ee`, 2026-07-21) serves every
`/dev/` response with `Content-Security-Policy: sandbox` and states "there are
NO exemptions". A sandboxed document cannot run JS, so since that commit:

- Cmd-P / Ctrl-P quick-open does nothing on any `/dev/docs/` page.
- Every doc browser page still renders the "Ctrl-P quick open" hint chip.
- Every page load logs `Blocked script execution … 'allow-scripts' permission
  is not set` to the console.

The two features were built ~two weeks apart (quick-open ≤ `16ad6d11`,
2026-07-09) and the hardening did not notice it was breaking the browser's own
script. Silent degradation: no test covers quick-open, and the CSP block only
shows in the browser console.

Resolution is not obvious — three directions, security call first:

1. **Accept the loss**: delete `renderDocQuickOpen`, the hint chip, and the
   quick-open CSS. Cheapest; the sidebar still navigates.
2. **Exempt the doc browser**: its HTML is router-authored (not agent-authored
   dev/ artifacts), so `sandbox allow-scripts` on `/dev/docs/` pages only would
   not reopen the CSRF vector the CSP exists for — but it re-introduces the
   exemption category the B.2c comment deliberately closed.
3. **Move the doc browser** off the `/dev/` pipeline onto a surface with its
   own CSP (the `/workstreams/` app pattern).

(Separate, non-bug observation from the same investigation: browser extensions
also trigger this console message on plain rendered `.md` pages — that part is
noise outside our control, not this issue.)

**Resolution taken (2026-08-19):** none of the three directions above — the
boxholder removed the sandbox CSP from `/dev/` entirely (rationale in the
sibling issue and in `bin/router-docs.ts` `serveDev`), which un-blocks the
quick-open script as-is. No code change to the doc browser was needed.

## Manual testing

After merge + router restart: open `/main/dev/docs/`, press Cmd-P (Ctrl-P),
confirm the quick-open palette appears and navigates, and confirm the console
no longer logs the blocked-script error.


## Superseded (2026-08-24)

Two things landed after this was filed, and between them the issue has no
subject:

1. The boxholder removed the `/dev/` sandbox CSP entirely (2026-08-19), which
   was the blocking mechanism.
2. Commit `46b03219` retired the doc browser into the general browser
   (`/workstreams/browse`), so the inline-script page this issue is about is no
   longer served at all.

Quick-open survives in the successor, and cannot regress the same way: it is
`workstreams-app/src/frontend/components/QuickOpen.tsx`, a React component
mounted in the app shell rather than an inline `<script>`, and nothing in the
workstreams app or its supervisor sets a CSP.

Related: agents can now load both surfaces to check things like this
themselves — [agents cannot reach the dev surface](../../closed/features/2026-08-24-agents-cannot-reach-the-dev-surface.md).
