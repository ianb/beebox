# Capturing one feed item from a logged-in browser (2026-10-15)

Snapshot survey for the Clerk extension
([issue](../issues/features/2026-10-15-clerk-send-to-box-sorted-like-quick-chat.md),
part 2). Question: how do extensions save the single post a person is looking
at on Instagram, Facebook, X, Reddit, Threads, LinkedIn and similar feeds,
without the rest of the feed? Baseline: the Clerk clones the whole document and
runs Defuddle, DOMPurify, then Turndown
(`beebox-clerk/src/platform/extract-readable.ts`). No site was logged into for
this survey. Items marked **[unverified]** were not confirmed from a source.

Server-side fetch of blocked sites is a separate question, covered by the
`web-search-fetch` workstream ([research/web-search-fetch/](web-search-fetch/)).

## Defuddle already has per-site extractors

Defuddle (the library the Clerk and Obsidian Web Clipper use) has a registry
of site extractors chosen by URL host or regex, then `canExtract()`; the first
match wins ([registry](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractor-registry.ts),
[extractors](https://github.com/kepano/defuddle/tree/main/src/extractors)).
On `main`: bluesky, discourse, github, hackernews, linkedin, mastodon, medium,
reddit, substack, threads, twitter, x-oembed, youtube, and others. There is no
Instagram, Facebook or TikTok extractor. The browser bundle runs them in the
page; Obsidian Web Clipper calls `new Defuddle(document, {url}).parseAsync()`
in its content script
([content.ts](https://raw.githubusercontent.com/obsidianmd/obsidian-clipper/main/src/content.ts)).
Release notes: LinkedIn, Threads and Bluesky extractors arrived in 0.18.0;
0.19.0 fixed X ([releases](https://github.com/kepano/defuddle/releases)). The
Clerk pins `^0.18.1`.

`includeReplies` defaults to `'extractors'`, so extractors keep comments
unless told otherwise. The only scoping option is `contentSelector` (a CSS
string); nothing accepts an element.

| Site | Container the extractor uses | Limit |
|---|---|---|
| X | `article[data-testid="tweet"]` in `[data-testid="cellInnerDiv"]` ([twitter.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/twitter.ts)) | first article is the main tweet |
| Reddit | `shreddit-post`; old Reddit `.thing.link` ([reddit.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/reddit.ts)) | post page |
| Threads | `[data-pagelet^="threads_post_page_"]`, `[data-pressable-container]` ([threads.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/threads.ts)) | permalink page only |
| LinkedIn | `[role="article"].feed-shared-update-v2` ([linkedin.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/linkedin.ts)) | takes the FIRST post, even on the feed |
| Bluesky | `[data-testid^="postThreadItem-by-"]` ([bluesky.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/bluesky.ts)) | thread page |
| Mastodon | `.detailed-status__wrapper` ([mastodon.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/mastodon.ts)) | detects Mastodon by DOM markers |
| YouTube | page JSON, JSON-LD, OG ([youtube.ts](https://raw.githubusercontent.com/kepano/defuddle/main/src/extractors/youtube.ts)) | watch page |

Every extractor targets a permalink or thread page. None picks one item out of
a scrolling feed. That is the gap the Clerk has to fill itself.

## Techniques other tools use

1. **Scope to a chosen element, then extract.** Walk up from the right-clicked
   node, or the node at the viewport center, to the post container
   (`closest(...)`). Zotero's Twitter translator does
   `closest('article')` from a known inner anchor
   ([Twitter.js](https://github.com/zotero/translators/blob/master/Twitter.js)).
   No extension source was found that uses `elementFromPoint` at the viewport
   center **[unverified]**; it is a standard DOM API.
2. **Per-site adapters with a generic fallback.** Zotero translators pair a
   URL `target` regex with `detectWeb` (one item or `"multiple"`) and `doWeb`
   ([docs](https://www.zotero.org/support/dev/translators)). Omnivore's
   server-side `content-handler` has per-site handlers
   ([list](https://github.com/omnivore-app/omnivore/tree/main/packages/content-handler/src/websites)).
3. **The ARIA feed pattern.** `role="feed"` containing `role="article"`
   children with `aria-posinset` ([W3C APG](https://www.w3.org/WAI/ARIA/apg/patterns/feed/)).
   Whether Facebook follows it is **[unverified]**; one report says
   `[role="feed"]` failed there ([Distill](https://forums.distill.io/t/facebook-groups-feed/2199)).
4. **Selection first.** Obsidian Web Clipper clones the current selection range
   and exposes it as `{{selection}}`/`{{selectionHtml}}`
   ([variables](https://obsidian.md/help/web-clipper/variables)). Text only;
   awkward in React feeds.
5. **CSS-selector templates.** Obsidian's `{{selector:css}}` templates,
   triggered by URL ([templates](https://obsidian.md/help/web-clipper/templates)).
   The model for user-editable adapters; it does not find the post.
6. **Metadata and oEmbed.** Meta made its oEmbed endpoints (Instagram,
   Facebook post/video, Threads) tokenless on 2026-06-15
   ([Meta blog](https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis/)),
   but the response has no caption or author
   ([reference](https://developers.facebook.com/docs/graph-api/reference/oembed-post/)).
   Mastodon `GET /api/oembed` is public
   ([docs](https://docs.joinmastodon.org/methods/oembed/)). Omnivore uses
   `publish.twitter.com/oembed` for X. All of these send the URL to a third
   party and miss what the logged-in person can see.

Site notes: Instagram and Facebook class names are generated and change
often; no stable container selector was verified for either. A permalink
anchor (`/p/<code>/`, `/reel/<code>/`, Facebook `/posts/`, `/permalink/`)
inside the nearest `article` or `[role="article"]` is the best available
signal **[unverified]**. Reddit custom elements (`shreddit-post`), X
`data-testid`, and Bluesky `data-testid` are test or component hooks and more
stable.

## Dispositions

The boxholder chose to send the full page first and design trimming from real
captures (2026-10-15: "We'll do the full capture, then use the examples to see
about trimming"). So none of these is built yet; each is a candidate for that
later design. A first attempt at the finder and item extraction is parked on
branch `wip-clerk-feed-items`.

| Idea | Disposition |
|---|---|
| Scope extraction to the post container found from the right-click target, else the viewport center | later: lead candidate |
| Run Defuddle on a small document holding only that container (plus `<head>`), with the real URL | later; Threads' extractor needs the surrounding pagelet, so test through to markdown |
| `includeReplies: false` | later, with item scoping |
| Per-host container table over a generic `article`/`[role=article]` walk (Zotero `target` + `detectWeb` shape) | later; verify Instagram and Facebook against real captures first |
| Show which post will be sent before sending | later, with item scoping |
| Permalink from the post's `<time>` anchor as the item URL | later, with item scoping |
| oEmbed and third-party API fallbacks (Meta, fxtwitter, Mastodon) | reject for now: send the URL to a third party and return less than the logged-in page |
| User-editable selector templates (Obsidian) | later, if a built-in table rots |
| Bump Defuddle past 0.18.1 | later; 0.18.1 already has the X, Reddit, Threads, LinkedIn, Bluesky, and YouTube extractors |
