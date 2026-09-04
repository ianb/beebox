---
title: "On-demand image thumbnails"
status: implemented
workstream: image-thumbnails
issues:
  - ../../../issues/closed/features/2026-09-03-on-demand-image-thumbnails.md
---
# On-demand image thumbnails

When a box contains a full-resolution photograph, a person wants small presentations to load from a derived image so the companion panel, chat, and Browse do not download the original photograph just to paint a few hundred pixels. The original remains available in the lightbox and through the raw file route.

**Issues addressed:** `2026-09-03-on-demand-image-thumbnails`. A queue search for `thumbnail`, `image transform`, `image cache`, `AVIF`, and `WebP` found no duplicate. `2026-06-18-avif-webp-for-stored-images` controls what intake stores and is not addressed here. `2026-08-21-rotated-image-cards-overflow-and-misplace-bbox` is a separate rendering defect and is not addressed here.

## Stated preferences this plan trades against

- The boxholder chose the route `/api/images/<path>?width=480&quality=75&format=auto`, Cloudflare option names and aliases, explicit `400` responses for bad options, derived files under git-ignored box state, and an unchanged `/api/files/*` route. The issue records: `issues/features/2026-09-03-on-demand-image-thumbnails.md:60`: *"Do not invent an option vocabulary."* It also records at line 78: *"The plain file route stays the original; nothing about `/api/files/*` changes."*
- The boxholder requires eventual cache purging: cached images must not grow without a bound. This plan therefore includes purge behavior in the first backend track, not as a follow-up.
- Principle 3 requires HTTP query input to be validated once at the boundary: `docs/engineering-principles.md:37`: *"Validate at boundaries and during parsing."*
- Principle 4 rejects silent fallback: `docs/engineering-principles.md:49`: *"Resilient AND never silent — and never resilient to the impossible."* A failed or saturated transform does not silently return original bytes.
- Principle 8 favors one image resolution path: `docs/engineering-principles.md:95`: *"One way to do each thing."* The raw-file and `.image.card` resolution code is shared by `/api/image/*` and `/api/images/*`.
- Principle 10 favors pure, directly testable decisions: `docs/engineering-principles.md:116`: *"Testability is architectural, and deeper than usual taste."* Query normalization, format negotiation, cache identity, and eviction selection are pure functions around a small I/O shell.
- The repository validation contract says: `CLAUDE.md:17`: *"Run `pnpm test:changed` before committing."* Browser verification is added because the work changes visible image and lightbox behavior.

## What already exists

- `src/webapp/routes/api-image.ts:4`: *"GET /api/image/* — resolve and serve an image by box-relative path"*. Lines 6–14 say it accepts raw image paths and `.image.card` paths and anticipates thumbnail parameters. Reuse its containment, card dereference, annex-pointer, and image-type boundaries by extracting a shared resolver. Do not duplicate them in the new route.
- `src/webapp/routes/api-image.ts:94-118` rejects paths outside the box and dotfiles before serving either the input path or its resolved attachment. Preserve both checks for transformations.
- `src/webapp/routes/api-image.ts:123-133` returns `409` for annexed content that is absent locally. The transform route preserves this response instead of attempting to decode the annex pointer.
- `src/webapp/file-etag.ts:2`: *"The file version token shared by every surface that hands out or checks file state"*. Reuse `fileEtag(stat)` as the authoritative source version in the derived cache identity.
- `src/webapp/routes/api-files.ts:150-168` uses the source ETag and `Cache-Control: no-cache` for browser revalidation. The transformed route follows the same freshness posture while using a transformed-output ETag.
- `src/frontend/src/lib/file-version.ts:13-17` says the frontend adds `?v=<token>` only after a file changes in the current session and otherwise relies on ETag revalidation. Line 28 currently recognizes only `/api/files/`, even though canonical Markdown image URLs use `/api/image/`; extend recognition to both `/api/image/` and `/api/images/`. This closes a latent invalidation gap rather than preserving behavior that already exists on `/api/image/`. Do not mistake the session token for authoritative disk-cache invalidation.
- `src/frontend/src/lib/view-url.ts:272-279` says `/api/image/` is the canonical presentation URL because it accepts raw files and image cards. Add a transform URL builder beside `apiImageUrl`; retain `apiImageUrl` for original presentation and lightbox URLs.
- `src/frontend/src/components/ui/Image.tsx:91-94` uses a discriminated union to separate lightbox images from custom-click images. Extend that union so a responsive lightbox image cannot omit `lightboxSrc`; do not add unrelated transformation policy to the primitive.
- `src/frontend/src/components/ui/Image.tsx:170-188` renders only `src` and stores that same value in `data-image-src`. This must separate display `src`/`srcSet` from the original stored for lightbox collection.
- `src/frontend/src/components/LightboxProvider.tsx:40-82` collects `data-image-src` elements into the lightbox list. Keeping the original in that attribute preserves full-resolution navigation without changing the lightbox state shape.
- `src/frontend/src/components/ImageLightbox.tsx:2-5` says it opens full-resolution images and exposes an open-full-resolution control. Its image, swipe peers, and link continue to consume the original URL.
- `src/frontend/src/renderers/image.tsx:84-90` resolves an image card's `filename.ref` to a raw file URL. Lines 98–138 use it for both embedded and full-card presentation. These are the first callers to request transformed display URLs.
- `src/frontend/src/components/chat/markdown-rendering.tsx:25-38` already distinguishes the displayed in-box URL from the external proxy fallback. Only recognized in-box image URLs switch to transforms; external URLs remain untouched.
- `src/lib/box-tmp.ts:4-10` establishes that request-specific box data belongs under the box rather than shared host temp. `src/core/boxholder-cards.ts:28` excludes `.beebox/**` from boxholder content traversal. The durable derived cache uses `<boxRoot>/.beebox/image-cache/v1/`, which is box-local and git-ignored, rather than `os.tmpdir()` or the content tree.
- `src/core/housekeeping.ts:15-20` is existing prior art for age-based cleanup of git-ignored per-box files. The image cache needs its own size-aware sweep because thumbnail bytes can be much larger in aggregate than transient upload metadata.
- `sharp` is already declared in `beebox/package.json`; a repository search found no production import of it.

## Prior art (external)

- Cloudflare documents the selected vocabulary and semantics, including `scale-down`, `contain`, `cover`, `crop`, `pad`, and `dpr` up to 2: https://developers.cloudflare.com/images/optimization/features/
- Cloudflare documents `scale-down` as preserving aspect ratio without upscaling. It documents `contain` as preserving aspect ratio without adding padding, while `pad` expands the output canvas. It documents `dpr=2` as producing twice the physical dimensions for the same CSS box: https://developers.cloudflare.com/images/optimization/features/#dpr
- Cloudflare warns that AVIF encoding can be an order of magnitude slower than other formats and may fall back for inputs that cannot be encoded quickly. This implementation retains AVIF-first Accept negotiation but fixes Sharp AVIF effort at 1 for request-path work: https://developers.cloudflare.com/images/optimization/features/#format
- Sharp's resize API defaults to `cover`, not the selected Cloudflare `scale-down`. The adapter must map every accepted fit explicitly. Sharp provides `withoutEnlargement` for the no-upscale part of `scale-down`: https://sharp.pixelplumbing.com/api-resize/
- Sharp documents that only one `resize` operation takes effect in a pipeline. The implementation uses one mapped resize operation rather than composing fits: https://sharp.pixelplumbing.com/api-resize/
- A search of Sharp's official documentation found process-level worker/thread controls, but those do not express a per-box limit on simultaneous application requests. This plan uses an application semaphore and does not treat `sharp.concurrency()` as request admission control: https://sharp.pixelplumbing.com/api-utility/

## Tracks / scope

### Track 1 — Strict transform route and bounded cache

**What.** Add `GET` and `HEAD /api/images/*`. It resolves the same raw-image and `.image.card` inputs as `/api/image/*`, validates a closed query vocabulary, generates a derived raster through Sharp, caches it under box state, and serves cache hits without decoding the source again.

**Why this needs to change.** The issue reports that a multi-megabyte phone photograph delays a presentation only a few hundred pixels wide. `issues/features/2026-09-03-on-demand-image-thumbnails.md:11-18` records that current surfaces request the stored original.

**Direction.** Extract a shared `resolveBoxImage()` from `api-image.ts`. It returns the resolved absolute file path, source stat, and the existing typed HTTP failure. The new route parses query values into a closed `ImageTransformOptions` type:

```ts
interface ImageTransformOptions {
  width?: number;
  height?: number;
  fit: "scale-down" | "contain" | "cover" | "crop" | "pad";
  quality: number;
  format: "avif" | "webp" | "jpeg";
  dpr: number;
}
```

At least one of `width` or `height` is required. `width` and `height` are positive integers capped at 4096 CSS pixels. `dpr` is a number greater than zero and no greater than 2. The physical dimension after applying `dpr` must also be no greater than 4096 pixels. `quality` is an integer from 1 through 100. Defaults are `fit=scale-down`, `quality=85`, `format=auto`, and `dpr=1`. Long and short aliases normalize to the long names. Supplying both forms of one option is a `400`, even when values match, because accepting two inputs hides hand-edit drift. Unknown query keys are a `400`, except the existing frontend cache-buster `v` and chat retry token `imageRetry`, which are ignored by transform normalization.

`format=auto` negotiates AVIF, then WebP, then JPEG from `Accept`, following Cloudflare's documented Worker example. An explicit format does not negotiate. The route sends `Vary: Accept` for `auto`. AVIF uses Sharp effort 1 because this is request-path work; quality remains caller-controlled. Sharp applies EXIF orientation before the one resize operation so the rasterized pixels match browser presentation of the original.

The route accepts JPEG, PNG, WebP, AVIF, SVG, and GIF inputs that Sharp can decode. SVG is rasterized. GIF produces a still first-frame derivative only when a caller explicitly requests this route; the initial frontend allowlist never rewrites GIF, SVG, BMP, or ICO presentation URLs, so formats and animation that render today keep using the original.

Fit mapping preserves Cloudflare semantics rather than Sharp's names. `scale-down` uses Sharp `inside` with `withoutEnlargement`. `contain` uses `inside` and permits enlargement, without adding canvas pixels. `cover` uses Sharp `cover`. `crop` reads source dimensions: it returns the original-size/aspect derivative when the source is smaller than the target, otherwise it uses `cover` without enlargement. `pad` uses Sharp `contain` with an opaque white background because the selected output formats include JPEG.

The cache root is `<boxRoot>/.beebox/image-cache/v1/`. A SHA-256 filename hashes the resolved box-relative source path, `fileEtag(stat)`, normalized options after format negotiation, and cache schema `v1`. The extension records the negotiated output. Files are written to a unique sibling temporary path and atomically renamed. Concurrent requests for the same key share one in-flight promise after the initial disk lookup.

Each box process admits at most two Sharp transformations at once. Other valid misses wait in FIFO order; they do not receive original bytes. One owner holds the transform; same-key waiters attach to it. Once registered, queued and active work completes and populates the cache even if an HTTP requester disconnects; the first version does not add consumer-counted cancellation machinery. Every acquired permit releases in `finally`. A transform error is logged with the box-relative path and normalized options and returns a clear `415` for an undecodable/unsupported input or `500` for an encoder/cache failure. Invalid options return a `400` naming the option. Queueing is not reported as success with the wrong representation.

The cache is bounded by both age and bytes. A sweep removes entries older than 30 days, then removes the oldest remaining entries until total regular-file bytes are at most 512 MiB per box. Temporary files older than one hour are removed. A successful cache write triggers a sweep when at least one hour has passed since the previous sweep or 64 MiB has been written since it, preventing a busy transform stream from growing unchecked inside the hourly window. At most one sweep runs at a time in each box process. The request awaits that occasional sweep, so there is no detached maintenance promise or silent failure; failures are logged and do not discard the successfully generated response. A cache that receives no new writes cannot grow, and its next write performs the overdue cleanup. Cache reads and deletion tolerate an entry disappearing between `stat`, read, and unlink; generation retries the requested key when necessary. These fixed constants stay private to the cache module; this plan does not add configuration UI or environment variables.

Transformed responses use the cached file's content type and byte length, a strong output ETag, source `Last-Modified`, `Cache-Control: no-cache`, and `Vary: Accept` when negotiation occurred. A conditional hit returns `304`. `HEAD` resolves and validates identically and generates a missing representation so its content headers match `GET`, but sends no body. The route doctest pins this deliberate cold-HEAD cost.

**Vocabulary lock-ins.** The public route is plural `/api/images/*`. Public query names and aliases are `width`/`w`, `height`/`h`, `fit`, `quality`/`q`, `format`/`f`, and `dpr`. The ignored internal compatibility parameters are the file-watcher token `v` and chat's bounded retry token `imageRetry`; neither affects representation identity. The disk directory and hash layout are private cache implementation details.

**First implementation chunk.** Add pure option parsing, format negotiation, fit mapping, cache-key, and eviction-selection functions with doctests. Extract the shared image resolver. Add the route, two-slot semaphore, in-flight-key deduplication, atomic cache writes, and bounded sweep with route/filesystem doctests. Register it beside `/api/image/*`. No frontend switches in this chunk.

### Track 2 — Separate display and full-resolution image URLs

**What.** Let the shared `Image` primitive display a transformed `src` and responsive `srcSet` while recording a different original URL for lightbox navigation.

**Why this needs to change.** `src/frontend/src/components/ui/Image.tsx:186` currently sets `data-image-src` from the same `src` rendered by the `<img>`. Replacing that value directly would make the lightbox and its “Open full size” link use a thumbnail.

**Direction.** Add optional `srcSet` and `sizes` to base image props. In the `{ lightbox: true }` branch, make `lightboxSrc` required whenever `srcSet` is present; the no-`srcSet` form may omit it and keeps the current `src` default. The `<img>` receives display `src`, `srcSet`, and `sizes`. `data-image-src` receives the required `lightboxSrc` for responsive images. The existing `LightboxProvider` and `ImageLightbox` shapes remain unchanged because they already consume that data attribute as the full-resolution URL.

Add a path-based `apiTransformedImageUrl` beside `apiImageUrl` for renderers that already own a box-relative path. Add a narrowly separate URL recognizer for chat, whose Markdown inputs arrive as resolved URLs. It accepts canonical `/api/image/` and legacy `/api/files/` URLs without losing router prefixes, path encoding, or the `v` token. Both helpers return no transformed URL outside an initial photo-raster allowlist of JPEG, PNG, WebP, and AVIF. GIF, SVG, BMP, ICO, external, `data:`, blob, session-media, and history-blob URLs remain original. Callers choose widths; the shared primitive does not infer network policy from visual `size` names.

Use width-descriptor `srcset`, not `dpr` descriptors, for responsive fluid image-card presentations. Initial candidates are 480 and 960 physical pixels, with `sizes` matching the content column. The public `dpr` option remains tested and available to direct API callers, but frontend `srcset` does not combine `dpr` with width descriptors.

**Vocabulary lock-ins.** `src` is the displayed fallback URL. `srcSet` and `sizes` retain their native HTML meanings. `lightboxSrc` is the original full-resolution URL. Transform sizes remain explicit at call sites.

**First implementation chunk.** Extend the discriminated props, DOM attributes, failed-image bookkeeping, and image doctest. Prove that the displayed URL is transformed while the collected lightbox URL and open-full-size link remain original, including captions and swipe peers. Prove that the type rejects responsive lightbox images without `lightboxSrc`.

### Track 3 — Switch the reported image-card surfaces

**What.** Change full image cards, raw-image views, and embedded image cards to use responsive derived displays while retaining original lightbox URLs.

**Why this needs to change.** These are the direct path from the reported card to the companion panel. `src/frontend/src/renderers/image.tsx:98-138` renders the same raw URL for both embedded and full-card presentations.

**Direction.** Build URLs from the box-relative source rather than rewriting a URL. For image cards, use `/api/image/<card path>` as `lightboxSrc`, matching the sibling Browse marker's exact string. For raw images, retain `/api/files/<raw path>` as `lightboxSrc`, matching the sibling raw-file marker. This exact-string rule matters because `LightboxProvider` deduplicates and indexes by URL string. For the display, request `width=480` and `width=960`, `fit=scale-down`, `quality=85`, and `format=auto`. Use lazy loading for embedded images below the fold; retain eager browser behavior for the currently opened full card. If a transform request fails, show the existing clear broken-image state. Do not automatically download the original as an error fallback.

The bbox surface uses only `scale-down`. That preserves the source aspect ratio, so its percentage coordinate space remains unchanged. Add a regression assertion for an unrotated bbox over a transformed display. Do not claim that the already-filed 90/270-degree overlay defect is fixed.

**Vocabulary lock-ins.** The first responsive image-card candidates are 480w and 960w. Image-card bbox presentations use `scale-down`; they do not use `cover`, `crop`, or `pad`.

**First implementation chunk.** Switch supported photo formats in `ImageCardRenderer` and `RawImageRenderer`. Add focused frontend doctests, including a sidebar marker plus its panel image deduplicating to one lightbox entry. Verify a large image card through the companion panel at desktop and narrow widths, open its lightbox, inspect the full-size link, and exercise an unrotated bbox. Verify GIF, SVG, BMP, and ICO keep their original URLs.

### Track 4 — Switch ordinary in-box chat images

**What.** Apply the established helper to ordinary supported in-box chat images. Keep user attachment object URLs, external images, session media, history blobs, GIF, SVG, BMP, ICO, PDF renders, and extracted-document figures unchanged. The existing 24px image-card Browse preview is also a thumbnail surface and uses a 48px cached variant without changing the row design or its lightbox metadata.

**Why this needs to change.** `src/frontend/src/components/chat/markdown-rendering.tsx:25-58` sends canonical in-box images and external images through one presentation component.

**Direction.** Transform only photo-raster URLs the helper recognizes as canonical box images. Chat uses one `width=960`, `fit=scale-down`, `quality=85`, `format=auto` display URL and its original lightbox URL. It does not use `srcset`: chat's `retryOnError` changes `src` when an in-box image may be referenced before it exists, while the browser would continue selecting from an unchanged `srcset`. External hot-links retain their direct URL and existing proxy fallback. Animated and unsupported transform formats retain their original URL.

**Vocabulary lock-ins.** “In-box image” means a recognized `/api/image/` or `/api/files/` URL under the current router prefix. It does not mean every URL rendered by `Image`.

**First implementation chunk.** Switch recognized supported in-box Markdown images. Add tests proving GIF, SVG, BMP, ICO, external/proxy, blob, session-media, and history URLs pass through, and that retry changes the actual requested `src`. Browser-check chat with one image, an image grid, an external image, and a supported image referenced before it exists.

The shared non-chat Markdown renderer uses the same 960px display policy while
retaining the original lightbox URL. This covers agent-authored image embeds in
docs, recipes, saved webpages, commentary, and extracted image-card text—not
only chat messages.

## Could this be simpler?

The simplest version is one `/api/images/*?width=480` route, one cached file per source, and a direct `src` replacement in the image-card renderer. It fails four concrete cases: the lightbox would open the thumbnail because `Image.tsx:186` stores `src` as the full-size identity; simultaneous cold requests could run unbounded Sharp work; variants would accumulate forever despite the boxholder's explicit storage requirement; and blindly rewriting every image would freeze animated GIFs or break formats Sharp does not decode.

This plan adds only the structures those failures require: strict normalization for a public query boundary (principle 3), a two-slot semaphore and in-flight deduplication for real request concurrency, a bounded cache sweep, and one display-versus-lightbox prop. It does not add a cache database, daemon, admin screen, metrics subsystem, configurable presets, or generalized media pipeline.

## Subplans

None. The option vocabulary and URL shape are already decided. Cache admission, eviction, and frontend rollout fit in this plan without a separate research decision.

## Failure modes

There are no unresolved critical gaps. Every new codepath below has planned handling and coverage.

| What can fail | Test exists? | Handling exists? | Clear-or-silent? |
|---|---|---|---|
| Unknown, repeated, malformed, or out-of-range query option | Planned pure/route doctest | `400` names the option | Clear |
| Neither width nor height is supplied | Planned route doctest | `400` names the dimension requirement | Clear |
| `format=auto` receives an Accept header without AVIF/WebP | Planned negotiation doctest | JPEG is the defined fallback | Clear |
| AVIF cold encode consumes excessive request CPU | Planned real-encoder integration timing observation | effort 1 plus two-transform admission bound | Clear in test output and server latency |
| Source path escapes the box or resolves through a card outside it | Existing behavior plus planned route regression | `403` from shared resolver | Clear |
| Image card has no valid attachment ref | Existing behavior plus planned route regression | `404` from shared resolver | Clear |
| Annex pointer exists but content is absent | Existing behavior plus planned route regression | `409` before Sharp | Clear |
| Source changes while an old variant exists | Planned cache-key doctest | source ETag creates a different key | Clear through fresh bytes |
| Two requests miss the same key | Planned concurrency doctest | one in-flight promise and one output | Clear through shared result |
| Many different keys miss together | Planned concurrency doctest | FIFO queue, at most two transforms | Clear through bounded wait |
| Client disconnects while queued | Planned semaphore doctest | remove queued work when possible; always release permit | Clear in server debug context |
| One of several same-key waiters disconnects | Planned deduplication doctest | detach only that waiter; preserve the shared owner | Clear through remaining response |
| Sharp cannot decode an allowed extension | Planned route doctest | logged `415`; no original fallback | Clear |
| Encoder or cache write fails | Planned route doctest | logged `500`; temporary file cleaned | Clear |
| Process dies during cache write | Planned filesystem doctest | unique temp remains; later sweep removes it | Clear through recovery |
| Cache exceeds 512 MiB or entries age past 30 days | Planned filesystem doctest | oldest entries removed to both bounds | Clear through deterministic eviction |
| Sweep races with a cache read or generation | Planned filesystem concurrency doctest | tolerate disappearance and regenerate requested key | Clear through successful response or logged error |
| Transformed display is accidentally collected as full-size | Planned frontend doctest | `lightboxSrc` owns `data-image-src` | Clear in DOM assertion |
| External or special image URL is rewritten | Planned URL-helper doctest | helper returns `null`; caller passes through | Clear in DOM assertion |
| GIF, SVG, BMP, or ICO is rewritten and loses behavior | Planned URL-helper and renderer doctests | photo-raster allowlist keeps original URL | Clear in URL assertion |
| Bbox display uses a cropping fit | Planned renderer doctest | renderer hard-codes `scale-down` candidates | Clear in URL assertion |
| 90/270-degree bbox remains misplaced | Existing filed issue; not a regression introduced here | explicitly not claimed fixed | Clear in scope and handoff |

## Agent-flow / user-flow edge cases

- **Wrong tag / wrong field — ADDRESSED.** This adds no card field or agent-authored tag. Query validation rejects near-miss option names and names the invalid option in the response (Track 1).
- **Stale ref — ADDRESSED.** Each request resolves the current `.image.card` attachment and versions the resolved source stat. A moved or missing target returns the shared resolver's clear `404` (Track 1).
- **Two agents touching the same card — ADDRESSED.** The route does not mutate cards. A changed source produces a different `fileEtag` cache identity; identical requests deduplicate only after resolution and versioning (Track 1).
- **Hand-edit drift — ADDRESSED.** Conflicting long/short aliases are rejected rather than silently prioritized. Unknown options are rejected (Track 1).
- **Fabricated free-form value — ADDRESSED.** Closed unions and numeric bounds make accepted values explicit. There is no free-form transform preset (Track 1).
- **Validation error UX — ADDRESSED.** The JSON `400` response names the offending option. Frontend call sites use typed URL builders and should not produce invalid values (Tracks 1 and 2).
- **Partial migration / transition state — ADDRESSED.** There is no data migration. The backend route lands and passes before any caller switches. `/api/files/*` and `/api/image/*` remain valid throughout (implementation order).
- **Cache cold after purge — ADDRESSED.** The next request regenerates under the same two-slot bound. Purging changes latency once, not correctness (Track 1).
- **Original requested from lightbox — ADDRESSED.** The lightbox uses `lightboxSrc`; transformed display URLs never replace the original identity (Track 2).

## NOT in scope

- Do not change what intake stores or implement `2026-06-18-avif-webp-for-stored-images`; this cache is derived and disposable.
- Do not change `/api/files/*`, its Range behavior, or its download semantics.
- Do not replace the canonical `/api/image/*` original-image route. `/api/images/*` is the explicit transform route.
- Do not transform external URLs, proxy responses, session media, history blobs, object URLs, PDF page renders, or extracted-document figures in this workstream.
- Do not redesign Browse rows or add thumbnails where none exist. The existing
  24px image-card preview uses a 48px cached variant. Browse lightbox metadata
  stays original and establishes the exact full-size identity panel images must
  match.
- Do not fix the 90/270-degree image overflow or bbox mapping issue. Verify this work does not worsen the unrotated case.
- Do not add crop gravity, background query parameters, animation preservation controls, metadata retention controls, or Cloudflare options beyond the settled subset.
- Do not add cache settings, cache inspection UI, manual purge UI, metrics dashboards, a database, a daemon, or a machine-global cache.
- Do not fall back to full-resolution bytes on a cache miss, queue, transform error, or invalid option.

## Open design questions

None block implementation. The public vocabulary, defaults, limits, concurrency, failure posture, cache bounds, purge trigger, and first surfaces are fixed above. Real hosted measurements may justify changing the private concurrency or cache constants after this plan ships, but they are not transition-time choices.

## Knowledge audits

This route is also an agent-facing view-authoring capability. The generated
views reference exposes a typed `imageUrl(path, options)` helper so an agent can
request a bounded, cached image without hand-building router-aware URLs, while
`fileUrl(path)` remains the original for downloads and full-resolution links.
The chat prompt separately says that ordinary Markdown photo embeds are already
bounded automatically and should continue to use plain box paths.

Add a `knows_about` audit which asks an agent authoring an image-heavy custom
view how it avoids downloading originals for thumbnail-sized displays. It must
read `docs/generated/views.md`, choose `imageUrl` with a width and `format:
"auto"`, and preserve `fileUrl` for an original/full-size link. Add a
chat-mode `knows_directly` audit which verifies that an ordinary inline photo
embed uses the plain box path rather than a hand-built `/api/images/` URL.

## What will hold this after it ships

- A pure-function doctest holds aliases, defaults, duplicate rejection, numeric bounds, Accept negotiation, explicit format behavior, Sharp fit mapping, cache identity, and eviction ordering.
- A route doctest built with the existing test server holds raw files, `.image.card` dereference, containment, dotfile rejection, annex absence, `GET`, `HEAD`, conditional `304`, content type, `Vary`, and clear errors.
- A filesystem doctest using a temporary box holds atomic generation, cache hits, source-version invalidation, in-flight deduplication, the two-transform ceiling, orphan-temp cleanup, age expiry, and the 512 MiB eviction rule. The test injects a transformer and clock rather than depending on slow image encodes for concurrency and age decisions; one small real Sharp fixture proves decode, orientation, resize, and output format integration.
- Frontend doctests hold transformed display attributes, original lightbox collection, URL pass-through boundaries, responsive candidates, and bbox use of `scale-down`.
- Browser verification holds the user-visible companion, chat, lightbox, and narrow-layout behavior. It records network requests to prove small presentation URLs use `/api/images/*` while the opened lightbox and full-size link use the original.
- No new test tier or tour is needed. Existing pure, route, filesystem, frontend doctest, and browser tiers reach the risky decisions.

## Implementation order

1. Add option/format/cache decision tests and pure helpers.
2. Extract the shared image resolver and preserve `/api/image/*` behavior.
3. Add `/api/images/*`, Sharp transformation, two-slot admission, in-flight deduplication, atomic cache writes, and bounded purge. Run backend focused tests.
4. Add frontend transform URL construction and the display/full-resolution `Image` contract. Run frontend focused tests.
5. Switch image-card, raw-image, and embedded-image-card presentations. Verify companion and lightbox behavior.
6. Switch ordinary supported in-box chat images. Verify retry and pass-through cases, including animated GIF and external images.
7. Run `pnpm --dir beebox test:changed`, `pnpm --dir beebox typecheck`, `pnpm --dir beebox lint:changed`, `pnpm --dir beebox doc-check`, and `git diff --check`. Package meaningful desktop/narrow/network screenshots in one `ask: fyi` exhibit.
8. Cross-model review the completed branch diff, adjudicate findings, and rerun implicated checks. Ship the plan as one unit only when the boxholder requests `/finish`.

## Rollout shape

Tests lead each implementation chunk. The backend route does not acquire callers until its validation, source resolution, concurrency, cache hit, invalidation, and purge tests pass. The frontend contract does not acquire image-card callers until tests prove the lightbox retains the original. Chat switches only after the reported card and Browse companion-panel surface works.

Done means all planned doctests pass; changed-file typecheck and lint pass; doc-check and diff-check pass; the real browser shows transformed network requests at desktop and narrow widths; the lightbox displays and links to the original; a many-photo page never exceeds two injected concurrent transformations in its backend test; and a synthetic oversized/stale cache is reduced to the stated age and byte bounds. There is no schema or persisted-data migration. Deleting `.beebox/image-cache/v1/` at any time is a safe rollback for cached data; reverting frontend callers returns presentation traffic to the unchanged original routes.
