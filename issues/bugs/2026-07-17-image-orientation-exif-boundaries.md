---
title: "Image orientation can break when EXIF metadata is dropped across upload boundaries"
area: callback-box
filed-by: agent
discovered-in: main session - testing camera attachments in the iOS companion app
---

A photo taken in the iOS companion app arrived in chat with the wrong
orientation. The immediate native-camera path now redraws the `UIImage` into an
upright bitmap before JPEG compression (`ios-app/CallbackBox/Views/NativeComposerView.swift`),
with a regression test covering a metadata-rotated source image. That fixes the
observed path, but the underlying contract is still implicit.

Images enter Callback Box through several routes: native camera capture, native
photo-library selection, browser camera capture, paste/drop/file selection,
capture-session uploads, and existing image files. Some routes re-render pixels;
others preserve the source bytes and rely on EXIF orientation. Later boundaries
may decode, transcode, persist, preview, or hand the image to a model without
preserving or honoring that metadata. A photo can therefore look correct at
selection time and rotate only after upload or processing.

We should define and enforce one orientation invariant at image-ingress
boundaries. Likely directions:

- Normalize orientation into pixels whenever an image is transcoded, and remove
  or reset the orientation tag in the result.
- Preserve original bytes when avoiding a lossy generation, but verify every
  downstream decoder honors EXIF orientation or normalize during the first
  required transcode.
- Test all eight EXIF orientation values through native camera, native gallery,
  browser camera, paste/file upload, persisted attachment, preview, and model
  input paths.
- Check whether extracted EXIF metadata should retain the original orientation
  value after visual normalization, or record normalization separately so image
  analysis remains intelligible.

The existing iOS fix should be treated as a local guard, not evidence that the
broader upload and image-processing pipeline is orientation-safe.
