# On-demand image transforms

`GET` or `HEAD /api/images/<box-relative image path>` produces a derived raster
on demand. The source path stays in the URL path; transform choices are query
parameters. For example:

```
/api/images/store/photo.jpg?width=480&quality=75&format=auto
```

At least one of `width` or `height` is required. `width`/`w` and `height`/`h`
are positive integers up to 4096; after applying `dpr` (greater than zero and
at most 2), each physical dimension must still be at most 4096. `fit` defaults
to `scale-down` and also accepts `contain`, `cover`, `crop`, and `pad`.
`quality`/`q` is 1 through 100 and defaults to 85. `format`/`f` accepts `auto`
(the default), `avif`, `webp`, or `jpeg`; `auto` negotiates from `Accept` and
adds `Vary: Accept`.

Invalid, repeated alias, unknown, or out-of-range options return `400`; a
transform never silently returns the original. A source which Sharp cannot
decode returns `415`. `/api/files/*` and `/api/image/*` remain original-image
routes.

Derived files are private box state under `.beebox/image-cache/`, keyed by the
source version and normalized representation. The cache shares same-key work,
permits two concurrent transforms per box, expires entries after 30 days, and
evicts oldest entries to stay within 512 MiB. Callers should use this route for
bounded display images and keep the original URL for downloads or lightboxes.

Custom views receive `imageUrl(path, options)`, which builds this URL without
hand-assembling it; their generated `docs/generated/views.md` reference
documents the helper.
