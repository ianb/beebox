---
title: "web push followup testing"
area: callback-box
needs: [manual-testing]
design: ../callback-box/docs/implemented-plans/web-push-notifications.md
filed-by: agent
discovered-in: worktree-web-push — while shipping Web Push (tracks A–E)
---

Web Push shipped (tracks A–E, see the design link). The code is merged and
deploys, but the feature is **dormant in prod until VAPID keys are set**, and the
real end-to-end paths were never exercised before merge (merged on green tests +
UI render + fake-mode e2e only). This tracks what's left.

## Confirmed 2026-07-19: it has never run, anywhere

Not just "unverified" — **zero executions in its lifetime**, verified directly:

- `/home/callback/.env` on prod contains **no VAPID keys** (`grep -c VAPID` → 0),
  so the server has never been able to send.
- `push-subscriptions.json` **does not exist** on prod *or* on the boxholder's
  local machine, so no browser has ever subscribed.

Shipped 2026-07-04; still dormant two weeks later. Every path below the
"Verification not yet done" heading has therefore run only against fakes.

## Keep-or-drop: settled — this is wanted

Asked 2026-07-19 whether the dormancy meant push was unwanted. Boxholder:
*"it's important, I just haven't gotten around to it. I'm highly confident it is
important."* So this is **not** a candidate for removal — it's a finished feature
waiting on one ops step and a verification pass, and it should be treated as
scheduled work rather than re-triaged as a maybe.

Practical consequence: code touching push is worth keeping correct. The
[v2 box-slug bug](../bugs/2026-07-11-v2-box-slug-from-boxroot-basename.md) lists
`send-push.ts` among the sites deriving a slug wrongly — fixing that *before*
push goes live is the right order, since a wrong slug would key subscriptions
under `"content"` for every box (cross-box delivery) the moment the first one is
written.

The unblock is small and sequenced: **install VAPID keys → the desktop
end-to-end → then everything else below.** Nothing in the verification list can
start until the keys exist.

## Blocking prod use

- **Generate + install prod VAPID keys.** `npx web-push generate-vapid-keys`, add
  `CB_VAPID_PUBLIC_KEY` / `CB_VAPID_PRIVATE_KEY` (optional `CB_VAPID_SUBJECT`) to
  `/home/callback/.env`, then `systemctl restart cb-hub callback-scheduler`.
  Documented in `callback-box/deploy/README.md` → "Web Push (VAPID) keys". Until
  then the Admin "Enable notifications" button reports "Push is not configured on
  the server" and nothing sends. (Ops task, not a code change.)

## Verification not yet done

- **Real desktop end-to-end.** With keys set: open a box Admin page in
  Chrome/Firefox → Enable notifications → grant permission → `cb push test
  --text "…"` → confirm a real OS notification appears and clicking it focuses the
  box. (Set up during implementation via an isolated router with keys, but the
  human-side click-through wasn't completed before /finish.)
- **Trigger-path end-to-end.** Fire a real schedule-health alert or a
  newly-pending question through `cb finalize` and confirm the push arrives the
  way a real alert would — the `web-push` card deletes on delivery, and a delivery
  failure leaves a `failed` card (not a silent drop).
- **iOS Home-Screen install.** On a real iPhone/iPad: add the box to the Home
  Screen, open from the icon, enable notifications from Admin, confirm a push
  arrives. Also confirm the Add-to-Home-Screen coaching shows in iOS Safari before
  install, and that SW scope + deep-link URLs work through the prod
  `box.example.com/<box>/…` path prefix.
- **`pushsubscriptionchange` rotation** is best-effort and Safari may not fire it;
  the `/api/push/resubscribe` route + visit-time re-subscribe cover it, but the
  rotation path itself is untested (hard to trigger deliberately).

## Known consistency nit (low priority)

- **A connector `git add`s a card it just deleted.** Both the new push connector
  (`callback-box/src/connectors/push.ts`) and the existing telegram output-card
  connector (`callback-box/src/connectors/telegram-output-cards.ts`) stage a card
  immediately after deleting it on delivery; for an *uncommitted* card that errors
  (`pathspec did not match`). The real flow always commits the card first
  (`notify-boxholder.ts` does), so it doesn't bite in practice — only a
  hand-dropped or agent-dropped uncommitted card would. If worth hardening, fix
  **both** connectors together (shared helper), don't diverge one.

## Deferred by design (from the plan's NOT-in-scope — revisit only if wanted)

- **Per-box PWA install identity** — a dynamic per-box manifest so the installed
  icon opens straight to the box instead of the box selector. Deferred (boxholder
  call); root install works and push is cross-box regardless.
- **Per-endpoint / per-severity filtering** — today an endpoint opting in gets all
  of that box's alerts; no per-device severity filtering.
