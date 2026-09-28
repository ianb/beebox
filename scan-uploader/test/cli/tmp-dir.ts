/** Package-local temp directories for tests — `scan-uploader/test/tmp/`, not
 * the system `/tmp`, so fixtures stay inside the repo (gitignored) and
 * multiple test files never collide on shared system temp state. */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const TMP_ROOT = join(process.cwd(), "test", "tmp");

export async function makeTmpDir(prefix: string): Promise<string> {
  await mkdir(TMP_ROOT, { recursive: true });
  return mkdtemp(join(TMP_ROOT, `${prefix}-`));
}

export async function removeTmpDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
