---
title: "Doc browser's Cmd-P quick-open is dead under the /dev sandbox CSP"
workstream: unattached
area: router
filed-by: agent
discovered-by: Ian
discovered-in: worktree-workstream-story — a blocked-script console error while viewing a dev/ page
---
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
