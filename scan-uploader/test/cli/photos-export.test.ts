// # Apple Photos export
//
// The integration calls a fake `osxphotos` executable. It never touches a real
// Photos library.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exportPhotos } from "../../src/cli/photos-export.js";
import type { TargetConfig } from "../../src/cli/config.js";
import { makeTmpDir, removeTmpDir } from "./tmp-dir.js";

const root = await makeTmpDir("photos-export");
const oldPath = process.env.PATH ?? "";
const folder = join(root, "exports");
const bin = join(root, "bin");
await mkdir(folder);
await mkdir(bin);
const log = join(root, "args");
const fake = join(bin, "osxphotos");
await writeFile(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > '${log}'\nprintf x > '${folder}/new photo.jpg'\n`);
await chmod(fake, 0o755);
process.env.PATH = bin;
const target: TargetConfig = { folder, serverUrl: "https://box.example", box: "box", tokenPath: "/token", disposition: "keep", photos: { album: "Bee Box" } };
async function errorMessageFor(promise: Promise<unknown>): Promise<string> {
  try { await promise; return "(no error)"; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

// An export adds files to the target folder and reports only newly-created
// uploadable files. Arguments preserve the album as one argument and enforce
// JPEG conversion and the update behavior.
void test("An export adds files to the target folder and reports only newly-created uplo...", async (t) => {
  // Cleanup restores the process environment and removes temporary files:
  t.teardown(async () => {
    try {
      process.env.PATH = oldPath;
      await removeTmpDir(root);
    } catch (error) {
      t.error(error);
    }
  });
  t.check(await exportPhotos(target), 1);

  t.check((await readFile(log, "utf-8")).trim().split("\n"), ["export", folder, "--album", "Bee Box", "--update", "--convert-to-jpeg", "--download-missing", "--skip-live"]);

  // An unchanged second export reports no newly found photos:

  await writeFile(fake, "#!/bin/sh\nexit 0\n");
  await chmod(fake, 0o755);
  t.check(await exportPhotos(target), 0);

  // Full Disk Access failures are named explicitly so they cannot look like a
  // quiet album:

  await writeFile(fake, "#!/bin/sh\necho 'Operation not permitted: Photos library' >&2\nexit 1\n");
  await chmod(fake, 0o755);
  const accessMessage = await errorMessageFor(exportPhotos(target));
  t.check(accessMessage, "Apple Photos access denied for album \"Bee Box\"; grant Full Disk Access to the app running scan-uploader and allow the requesting app listed under System Settings → Privacy & Security → Automation to control Photos. Run one export manually first to approve any macOS permission prompts.");

  // If osxphotos is not found on PATH, the error gives both supported install
  // commands:

  process.env.PATH = join(root, "empty-path");
  const missingTool = await errorMessageFor(exportPhotos(target));
  t.check(missingTool, "osxphotos is not installed; install it with `uv tool install osxphotos` or `pipx install osxphotos`");
});
