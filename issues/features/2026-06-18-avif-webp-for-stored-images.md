---
title: "avif webp for stored images"
needs: [design]
area: callback-box
---

Every re-encode path today emits **JPEG** (or passes PNG through): `src/frontend/src/lib/image-paste.ts` downscales pasted/captured images to JPEG @0.85 (`outputType = isPng ? "image/png" : "image/jpeg"`). Connector intake (gmail attachments, etc.) stores originals as-is — usually JPEG, often *many* per thread. The box already **accepts** `.webp`/`.avif` (LFS + gitignore patterns at `src/core/box.ts:158-159`, mime maps in `commands/create.ts` and `describe-images-helpers.ts`), so storage/serving is ready — nothing *produces* the compact formats. AVIF cuts ~50% over JPEG at similar quality; WebP ~25–30%.

Where it pays off, in order:

- **Bulk connector intake (the real prize).** The paths where lots of images land, usually JPEG. This is server-side, so it needs a real encoder (`sharp`, or a WASM codec) — not the browser canvas. **Posture for long-term box additions: lossless, high-effort.** Anything kept in the box archivally should not take *added* loss, and since intake encoding is a one-time cost the storage savings pay back forever, high compression effort (`sharp`'s `effort`/`quality:{lossless:true}`, `cwebp -z 9`, AVIF `cqLevel`/`speed 0`) is worth the slower encode. The crux is still **convert-in-place vs keep-original-and-derive**: lossless re-encode is reversible *in content* but not bit-for-bit, so true archival safety argues keep-original + derived compressed copy (doubles storage); convert-in-place is fine when the source is already lossy (re-encoding a JPEG losslessly to WebP just stops adding loss). Decide per source.
- **Client encode (paste + camera) — DONE.** A shared `lib/canvas-encode.ts` cascades **AVIF → WebP → JPEG** (feature-detected per session, since `canvas.toBlob` AVIF *encode* support is narrower than WebP's). Used for **photos** by `image-paste.ts` (chat paste/drop, 0.85) and `camera.ts`'s `canvasCapture` (0.85). **PNG sources are kept as lossless PNG** on the client: the canvas only produces *lossy* WebP/AVIF (no lossless flag), so converting a screenshot/line-art PNG would silently degrade it — so **PNG→WebP is explicitly a server-side (lossless) intake job, not a client one.** Two things still produce JPEG/PNG and are deferred to the server step: the camera's high-res `ImageCapture.takePhoto()` (OS-chosen JPEG, format not selectable — re-encoding would add a lossy generation), and PNG pastes (kept lossless). Both should get lossless AVIF/WebP server-side.

Decode/serving is a non-issue — WebP and AVIF are universally supported in current browsers; this is purely an encode-on-the-producer-side question.

Open questions: keep-originals-and-derive vs convert-in-place per source (archival safety vs storage); where the server encoder lives (deploy already installs imagemagick but nothing uses it for this — `sharp` would be the clean dep); a size threshold so tiny images aren't re-encoded; lossless+high-effort encode cost on big intake batches (do it async/off the request path).
