---
title: "Delivery paths derive the box slug from disk instead of using the served slug"
workstream: box-slug-helper
filed-by: agent
discovered-in: worktree-box-slug-helper — while fixing the basename(boxRoot) slug bug
area: beebox
---

`src/lib/box-slug.ts` made every disk-derived slug correct (see
[the v2 slug bug](../closed/bugs/2026-07-11-v2-box-slug-from-boxroot-basename.md)),
but deriving at all is the deeper smell: in every server-hosted path the process
already *knows* the authoritative slug and is choosing to re-derive it.

`bbx serve --slug custom` sets `BoxSpec.slug`, which becomes the URL prefix
(`server.ts:157`), the webhook mount (`server-box-scope.ts:248`), and the
push-subscription store key on the write side (`ctx.boxSlug`, `trpc/routers/push.ts`).
The read/delivery sides re-derive from the filesystem instead:

- `core/send-push.ts` — store lookup
- `core/notify-boxholder.ts` — `notifyChannels`
- `core/question-aging.ts` — the nudge URL
- `core/chat/session/pool.ts` — `sessionViewBaseUrl`
- `connectors/telegram.ts` — the webhook URL it registers with Telegram

So a box served under an explicit `--slug` still mismatches: it subscribes under
`custom` and looks up under the package basename. Nothing exercises `--slug` in
prod today, which is why this is queued rather than fixed.

The shape of a fix: `core/script-env.ts` already keeps a boxRoot-keyed registry
(`registerBoxPublicUrl`) populated at server start — extend it to carry the slug
and have the delivery paths read it, with `boxSlug()` as the fallback for
contexts that have no running server (CLI commands, `bbx view`, background sweeps).
The awkward part is ordering: the registry is populated in `startServer`, so
anything running before/outside that still needs the fallback, which means two
sources of truth unless the fallback is clearly scoped.
