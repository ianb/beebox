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
2. Run one uploader sweep manually from the Mac account that will own the
   schedule, and approve macOS permission prompts. Grant Full Disk Access to
   the app running scan-uploader, so osxphotos can read the Photos library;
   allow the requesting app shown under System Settings → Privacy & Security
   → Automation to control Photos. osxphotos uses Apple Events for
   `--download-missing`, so this permission is separate from Full Disk Access.
3. Mint a scan-upload token in this box's **Settings → Scan uploaders**. This
   token is shown once and the boxholder must keep it private; an agent must
   never mint, read, or handle it.
4. On the Mac, choose a folder for the exported photos and configure the
   uploader for this box. Exports go into the same folder as any other scanned
   files. From a checkout, run:

   ```bash
   bin/scan-uploader configure https://<host>/<box> \
     --name <token-name> --folder <photos-folder> --photos-album "<album name>"
   ```

   The configure command reads the token from the boxholder in a local
   terminal. On a copied-bundle setup, run `node scan-uploader.mjs configure`
   with the same arguments instead.
5. Run `bin/scan-uploader schedule install` to have the existing launchd job
   export and upload on its normal sweep. Re-run it if a schedule was already
   installed before adding the Photos source.

The Apple Photos library and launchd permission path have not been verified on
a real Mac. If the export reports access denied, check both Full Disk Access
and Automation permissions, then run one manual sweep to approve any pending
macOS prompts before installing the schedule.

Photos sources require the `keep` disposition so exported files and osxphotos'
update tracking database stay in place.

The agent can explain these steps but leaves all Mac setup to the boxholder:
do not install osxphotos, configure or run the uploader, approve macOS
permission prompts, or ask for or handle the scan token.
