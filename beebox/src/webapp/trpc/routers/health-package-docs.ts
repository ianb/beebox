/**
 * Health check for the **package docs** — beebox's reference docs, which live
 * in the installed package (`node_modules/beebox/box-docs/`, see
 * `core/docs-gen/package-docs.ts`) and which the agent guide points at on
 * every turn.
 *
 * Why it is a health check: `ensurePackageDocs` writes the directory on any
 * `generateDocs` run, so on a writable install it is always present. The case
 * this catches is an install it could not write — a read-only package from a
 * tarball whose `files` allowlist dropped the directory. There the agent's
 * pointers dangle silently; `generateDocs` logs once, and this is the place a
 * person sees it. Severity `error`: the guidance every agent is told to read
 * is missing, which is a broken install, not drift.
 */

import { join } from "node:path";
import { fileExists } from "../../../lib/file-exists.js";
import { getBoxShape } from "../../../lib/box-shape.js";
import { BOX_PACKAGE_DOCS } from "../../../core/docs-gen/shared.js";
import type { HealthCheck } from "./health.js";

export async function packageDocsCheck(boxRoot: string): Promise<HealthCheck> {
  const shape = await getBoxShape(boxRoot);
  const indexPath = join(shape.boxRoot, BOX_PACKAGE_DOCS, "README.md");
  if (await fileExists(indexPath)) {
    return {
      name: "package-docs",
      ok: true,
      message: `beebox reference docs present at ${BOX_PACKAGE_DOCS}/`,
      severity: "error",
    };
  }
  return {
    name: "package-docs",
    ok: false,
    message:
      `beebox reference docs are missing at ${BOX_PACKAGE_DOCS}/ — the agent guide points there. ` +
      "Any bbx activity rewrites them on a writable install; if the package is read-only, reinstall beebox (the release tarball ships them).",
    severity: "error",
  };
}
