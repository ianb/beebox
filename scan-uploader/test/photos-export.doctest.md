# Apple Photos export

The integration calls a fake `osxphotos` executable. It never touches a real
Photos library.

```ts setup
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { exportPhotos } from "../src/photos-export.js";
import type { TargetConfig } from "../src/config.js";
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
```

An export adds files to the target folder and reports only newly-created
uploadable files. Arguments preserve the album as one argument and enforce
JPEG conversion and the update behavior.

```
await exportPhotos(target)
=> 1
```

```ts continue
(await readFile(log, "utf-8")).trim().split("\n").join("|")
=> export|«*»|--album|Bee Box|--update|--convert-to-jpeg|--download-missing|--skip-live
```

An unchanged second export reports no newly found photos:

```ts continue
await writeFile(fake, `#!/bin/sh\nexit 0\n`);
await chmod(fake, 0o755);
await exportPhotos(target)
=> 0
```

Full Disk Access failures are named explicitly so they cannot look like a
quiet album:

```ts continue
await writeFile(fake, "#!/bin/sh\necho 'Operation not permitted: Photos library' >&2\nexit 1\n");
await chmod(fake, 0o755);
const accessMessage = await errorMessageFor(exportPhotos(target));
accessMessage.includes("grant Full Disk Access")
=> true
```

```continue
accessMessage.includes("Automation")
=> true
```

If osxphotos is not found on PATH, the error gives both supported install
commands:

```ts continue
process.env.PATH = join(root, "empty-path");
const missingTool = await errorMessageFor(exportPhotos(target));
missingTool.includes("uv tool install osxphotos") && missingTool.includes("pipx install osxphotos")
=> true
```

Cleanup restores the process environment and removes temporary files:

```ts cleanup
process.env.PATH = oldPath;
await removeTmpDir(root);
```
