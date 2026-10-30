---
title: "Clerk: \"send this to the box\" sorted to the right place, like quick chat, and feed items captured without the feed"
workstream: clerk-quick-send
needs: [design]
area: beebox-clerk
labels: [clerk, quick-chat, capture]
filed-by: agent
discovered-by: Ian
discovered-in: main session — 2026-10-15
---

## What the boxholder asked for

> I want the quick chat kind of approach we're using to apply to the Clerk
> extension. Basically "send this to the box" with it being sorted and put
> the right place automatically.

> One issue is Insta and Faceboook, and potentially other feeds, where there's
> a huge "page" but really it's the thing being looked at that is the actual
> thing to share. You can click through to the item, which is good, but
> sometimes a lot of junk is left over. Knowing about specific approaches for
> extensions to scrape these items well might be nice.

(Boxholder, 2026-10-15, in a main-checkout session.)

## Two parts

### 1. Send to the box, sorted

Quick chat already routes a new thought: `quickChat.submit`
(`beebox/src/webapp/trpc/routers/quick-chat.ts:100`) judges the message,
posts it to an existing chat or a new chat in a place when confidence is
high, and otherwise asks, with `choose` and `discard`
(`beebox/docs/chat/quick-chat.md`, `beebox/docs/box/quick-chat.md`). The
Clerk today saves pages, memos, and tab snapshots into the box's inbox
through the clerk API (`beebox-clerk/README.md`); the agent sorts them later.

The ask is one action in the Clerk that sends the page (or the item on it)
with an optional note, and gets the quick chat outcome: posted to the right
chat or place, or a short "where does this go?" choice in the popup or side
panel.

Questions:

- Whether a page capture goes through `quickChat.submit` as a message with
  the page attached, or the routing policy is reused by the clerk capture
  path. The capture also writes a webpage card; a page and a thought may
  route differently.
- Where the low-confidence choice appears (popup, side panel, a later
  notification) and what happens if the person closes the popup first. Quick
  chat keeps unsent and unsorted items on the box screen; the Clerk could
  use the same list.
- Auth: the Clerk's box credentials versus `authedProcedure`.

### 2. Feed items, not the feed

On Instagram, Facebook, and other feeds the page is a long scroll. The item
the person looks at is the thing to share. Clicking through to the item's
own URL helps, but extraction still keeps navigation, suggestions, and other
posts. The extractor today is generic: Defuddle, then DOMPurify, then
Turndown (`beebox-clerk/src/platform/extract-readable.ts`).

Research wanted: how extensions capture one feed item well. Candidates to
look at:

- the item under the viewport center, or the one the person right-clicked,
  found by walking up to the post container (`article`, `role="article"`,
  `data-*` post ids);
- per-site adapters keyed on the host, with a generic fallback;
- the item's own permalink and its embedded metadata (OpenGraph tags,
  JSON-LD), which some sites fill per post;
- what other clipper extensions do (for example Obsidian Web Clipper, which
  is built on Defuddle and uses per-site templates).

The extension runs in the person's logged-in browser, so it can see what the
person sees. Server-side fetch of the same sites is often blocked; see
[fetch blocked pages](2026-10-04-fetch-blocked-pages.md), now under research
in the `web-search-fetch` workstream.

## Related

- [Quick drop entry points](2026-09-25-quick-drop-entry-points.md): the
  quick chat design this extends.
- [Chat input everywhere](2026-08-30-chat-input-everywhere.md).
- [Agent knows whether Clerk is installed](2026-09-05-agent-knows-which-client-and-whether-clerk-is-installed.md).
- [Clerk retry duplicate cards (closed)](../closed/bugs/2026-09-29-clerk-capture-retry-writes-duplicate-cards.md):
  a capture that also routes must still be idempotent.

## Progress

- 2026-10-15: research recorded in
  [feed-item capture survey](../../research/feed-item-capture-2026-10-15.md);
  plan at [clerk-quick-send](../../beebox/docs/implemented-plans/clerk-quick-send.md).
  Boxholder: the page stays a card, in an incoming location (not only
  `_tmp`), referenced from the chat.
- 2026-10-15: part 1 implemented on `worktree-clerk-quick-send` (Send to box,
  `clerk.send`, git-ignored `_content/incoming/`). Part 2 deferred by the
  boxholder: send the full page now, design trimming from real captures; a
  first finder is parked on branch `wip-clerk-feed-items`. This issue stays
  open for part 2.

Re-reviewed 2026-10-30: part 1 shipped; part 2 (feed items) is untouched and the parked finder is still only on `wip-clerk-feed-items`. The owning worktree `clerk-quick-send` no longer exists.

Out of date in the body above: Retitle to the open half (capture one feed item, not the whole feed page) and set workstream to unattached; the clerk-quick-send worktree is gone.
