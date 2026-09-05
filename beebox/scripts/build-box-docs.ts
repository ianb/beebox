#!/usr/bin/env tsx
/**
 * Write the engine's reference docs into `<PACKAGE_ROOT>/box-docs/` so a
 * release tarball ships them (`box-docs` is in package.json `files`).
 *
 * At runtime every `generateDocs` call does the same thing (`ensurePackageDocs`
 * in `src/core/docs-gen/package-docs.ts`), which keeps a writable checkout
 * current on its own. A packed install may be read-only, so `scripts/release.ts`
 * runs this before `pnpm pack`. Prints nothing when the directory was already
 * current; one line when it wrote; fails when it cannot write.
 */

import { ensurePackageDocs } from "../src/core/docs-gen/package-docs.js";
import { assertNever } from "../src/lib/invariant.js";

const result = await ensurePackageDocs();
switch (result.status) {
  case "current":
    break;
  case "written":
    process.stderr.write(`[build-box-docs] wrote ${result.dir}\n`);
    break;
  case "unwritable":
    process.stderr.write(`[build-box-docs] FAILED: ${result.reason}\n`);
    process.exit(1);
    break;
  default:
    assertNever(result);
}
