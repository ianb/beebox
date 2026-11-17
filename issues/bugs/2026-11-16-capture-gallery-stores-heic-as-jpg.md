---
title: "The capture gallery picker stores a HEIC photo under a .jpg name"
workstream: unattached
area: beebox
labels: [capture, images, upload]
filed-by: agent
discovered-by: agent
discovered-in: heic-upload — surveying image upload paths for HEIC, 2026-11-16
---

On the capture page, a photo picked from the gallery uploads as its original bytes. `uploadPhoto` names the file from the blob's type: anything other than PNG becomes `photo-NNN.jpg` (`beebox/src/frontend/src/pages/capture/useCaptureSession/useCaptureUploads.ts`, `const ext = blob.type.includes("png") ? "png" : "jpg"`). A HEIC from desktop Chrome or Firefox is therefore stored as an image card whose `.jpg` file holds HEIC bytes (`writeImageCards` in `beebox/src/core/capture/prepare/write-cards.ts` keeps the `.png`/`.jpg` extension and copies the bytes unchanged).

The upload shows "uploaded". The failure appears later: sharp cannot decode HEIC (its prebuilt libvips reads HEIF only for `.avif`), so `/api/images` returns 415 for the card's thumbnail, and triage records "Preparation failed" for the image.

iOS Safari usually converts a HEIC to JPEG for an `accept="image/*"` picker, so the phone path is less likely to hit this. That was not verified.

The same naming rule also labels a WebP camera frame (`camera.ts` encodes WebP when it can) as `.jpg`; sharp reads it by content, so that case works by accident.

## Options

- Convert in the browser before upload, with the HEIF decoder the chat composer uses (`beebox/src/frontend/src/lib/heif/`). A canvas re-encode drops EXIF, so the card loses the photo's original date and location.
- Keep the HEIC and convert on the server. Production's ImageMagick reads HEIC (libheif 1.17.6, checked 2026-11-16), so thumbnails and triage could convert through it.
- At least, name the file by its real format so the stored card does not claim to be a JPEG.
