---
title: "avif webp for stored images"
workstream: unknown
needs: [design]
area: beebox
priority: backlog
---

Current scope: connector-wide archival image optimization remains undecided.
Client photo capture already prefers WebP with JPEG fallback, while PNG pastes
remain PNG. PDF extraction produces generated page and figure derivatives;
the [WebP follow-up](../../beebox/docs/implemented-plans/pdf-render-webp.md) changes new
derivatives to WebP and keeps existing AVIF readable. Originals remain intact.
This follow-up does not implement bulk connector conversion.

Where it pays off, in order:

- **Bulk connector intake (the real prize).** The paths where lots of images land, usually JPEG. This is server-side, so it needs a real encoder (`sharp`, or a WASM codec) — not the browser canvas. **Posture for long-term box additions: lossless, high-effort.** Anything kept in the box archivally should not take *added* loss, and since intake encoding is a one-time cost the storage savings pay back forever, high compression effort (`sharp`'s `effort`/`quality:{lossless:true}`, `cwebp -z 9`, AVIF `cqLevel`/`speed 0`) is worth the slower encode. The crux is still **convert-in-place vs keep-original-and-derive**: lossless re-encode is reversible *in content* but not bit-for-bit, so true archival safety argues keep-original + derived compressed copy (doubles storage); convert-in-place is fine when the source is already lossy (re-encoding a JPEG losslessly to WebP just stops adding loss). Decide per source.
- **Client encode (paste + camera) — DONE.** A shared `lib/canvas-encode.ts` prefers **WebP → JPEG** (feature-detected per session; AVIF is excluded for vision-provider compatibility). Used for **photos** by `image-paste.ts` (chat paste/drop, 0.85) and `camera.ts`'s `canvasCapture` (0.85). **PNG sources are kept as lossless PNG** on the client: the canvas only produces *lossy* WebP/AVIF (no lossless flag), so converting a screenshot/line-art PNG would silently degrade it — so **PNG→WebP is explicitly a server-side (lossless) intake job, not a client one.** Two things still produce JPEG/PNG and are deferred to the server step: the camera's high-res `ImageCapture.takePhoto()` (OS-chosen JPEG, format not selectable — re-encoding would add a lossy generation), and PNG pastes (kept lossless). Both should get lossless AVIF/WebP server-side.

Browser decoding, renderer selection, and vision-provider support are separate boundaries. The WebP follow-up adds AVIF to loose-image preview; existing vision transport converts AVIF to JPEG where required. WebP can pass through that provider boundary directly.

Open questions: keep-originals-and-derive vs convert-in-place per source (archival safety vs storage); where the server encoder lives (deploy already installs imagemagick but nothing uses it for this — `sharp` would be the clean dep); a size threshold so tiny images aren't re-encoded; lossless+high-effort encode cost on big intake batches (do it async/off the request path).
