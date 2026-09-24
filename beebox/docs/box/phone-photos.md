---
title: Add iPhone photos through an Apple Photos album
read-when: The user asks how to send new photos from an iPhone Apple Photos album into this box.
---
# Add iPhone photos through an Apple Photos album

This is an optional input path. The boxholder creates an album in Apple Photos
on the phone; iCloud syncs it to their Mac; scan-uploader uses osxphotos to
export new album items as JPEGs and sends them through the existing scan-import
flow. The Mac and phone need to use the same iCloud Photos library. These arrive
as scan imports, so existing page pairing and any review questions still apply.

To set it up, the boxholder needs to:

1. Install the scan-uploader on the Mac and osxphotos (`uv tool install
   osxphotos`, or `pipx install osxphotos`). The box's **Settings → Scan
   uploaders → First-time setup on a new machine** explains the standard
   uploader installation; the same client supports Photos albums.
2. Grant Full Disk Access to the app running the launchd scan-uploader job, so
   osxphotos can read the Photos library.
3. Mint a scan-upload token in this box's **Settings → Scan uploaders**. This
   token is shown once and the boxholder must keep it private; an agent must
   never mint, read, or handle it.
4. On the Mac, configure the uploader for this box and folder, naming the
   album with `--photos-album "<album name>"`. The configure command reads the
   token from the boxholder in a local terminal. Then run
   `scan-uploader schedule install` to have the existing launchd job export and
   upload on its normal sweep. Re-run it if a schedule was already installed
   before adding the Photos source.

Photos sources require the `keep` disposition so exported files and osxphotos'
update tracking database stay in place.
