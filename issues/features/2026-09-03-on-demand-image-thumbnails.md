---
title: "Serve thumbnails on demand: a card with a full-resolution photo loads the whole file every time"
workstream: image-thumbnails
area: beebox
labels: [images, performance, ui]
filed-by: agent
discovered-by: Ian
discovered-in: main session — a boardgame card whose photo took many seconds to appear in the chat companion panel on the hosted box
---

Box images are served as stored, through `/api/files/<path>`, and every
surface that shows one asks for the original: the image renderer
(`src/frontend/src/components/ui/Image.tsx`) sets `<img src>` to the file
URL with no `srcset`, no `sizes`, and no smaller variant to ask for. A phone
photo is several megabytes, so a card in the companion panel, a browse
listing, or a chat embed waits on the full download to paint a few hundred
pixels. The boxholder hit this on a hosted box, where the link is slower than
localhost and the delay is many seconds per card.

The ask: a way for a caller to request a thumbnail of an image, produced on
demand and cached, so the first request pays the resize once and every later
one is a small file.

What exists:

- `sharp` is already a dependency (`beebox/package.json`) and nothing imports
  it; deploy also installs imagemagick for the same reason. Either resizes.
- `/api/files/*` already carries per-path cache-buster tokens
  (`src/frontend/src/lib/file-version.ts`), so a derived variant can reuse the
  same invalidation: the thumbnail's identity is the source path plus its
  version plus the requested size.
- The related format question is filed separately:
  [avif-webp-for-stored-images](2026-06-18-avif-webp-for-stored-images.md).
  That one is about what intake STORES; this one is about what a surface
  FETCHES, and a derived thumbnail can be WebP regardless of the original.

Shape to decide, not decided:

- **Address.** A query on the file route (`/api/files/<path>?w=480`) keeps one
  URL scheme and lets the cache-buster apply; a separate `/api/thumb/` route
  keeps the file route dumb. The first is fewer concepts.
- **Where the derived file lives.** Under the box's git-ignored state (a
  cache keyed by path + version + width), never in the content tree; a box
  must not grow a second copy of every photo that gets committed.
- **Who asks.** The image renderer should ask for a bounded width by default
  and switch to the original only in the lightbox
  (`components/ImageLightbox.tsx`), plus `srcset` so the browser picks. Chat
  embeds and browse thumbnails follow.
- **Cost on the request path.** The first resize of a large photo is
  hundreds of milliseconds; acceptable once, but a listing of fifty photos
  should not resize fifty in one request burst. Bound concurrency, and let a
  miss fall back to the original rather than block.
- The bbox overlay (`components/ui/BboxOverlay.tsx`) maps coordinates onto
  the rendered image; a thumbnail changes the pixel size but not the
  proportions, so it should be unaffected, but check the rotated-image case
  (`2026-08-21-rotated-image-cards-overflow-and-misplace-bbox.md`).

## Direction: Cloudflare's option vocabulary, our URL shape (boxholder, 2026-09-03)

Do not invent an option vocabulary. Cloudflare's image transform options are
what every agent and developer already knows, so use their names, values, and
defaults. Do NOT copy their URL shape: Cloudflare puts the options in a path
segment before the source (`/cdn-cgi/image/width=480/<source>`) because their
source can be a whole URL on another host. Ours is always a box path, so the
path goes in the path and the options go in the query:

    /api/images/store/photo.jpg?width=480&quality=75&format=auto

- Options, same names and short aliases as Cloudflare: `width`/`w`,
  `height`/`h`, `fit` (`scale-down` default, `contain`, `cover`, `crop`,
  `pad`; Cloudflare's other three can wait), `quality`/`q` (1–100, default
  85), `format`/`f` (`auto`, `avif`, `webp`, `jpeg`), `dpr` (up to 2).
- `format=auto` picks from the request's `Accept` header, as Cloudflare does.
- Unknown or out-of-range options are a 400 naming the option, not a silent
  original. Cloudflare documents that behaviour too.
- The cache key is the normalised option set plus the source path and its
  version token, so `w=480` and `width=480` are one entry.
- The plain file route stays the original; nothing about `/api/files/*`
  changes. A surface that wants a thumbnail switches route, which also makes
  thumbnail requests visible in logs as their own thing.

Reference for the options: https://developers.cloudflare.com/images/transform-images/transform-via-url/
