/**
 * History routes — serves a raw file blob from a specific commit (binary
 * download, so it stays a raw route). The JSON history endpoints (commit log,
 * diff, session log) live in the `history` tRPC router.
 */

import type { FastifyInstance } from "fastify";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { describeAbsentContent, parseAnnexPointer } from "../../lib/annex-pointer.js";
import { extensionToMimetype } from "../../lib/mimetype.js";
import { applyRawFileServingHeaders } from "../serving-security.js";
import { isInBoxNamespace } from "../../lib/box-namespace.js";

/**
 * Register history API routes.
 */
export async function registerHistoryRoutes(
  server: FastifyInstance,
  boxRoot: string
): Promise<void> {
  /**
   * GET /api/history/blob/:hash/* - Serve a file from a specific commit.
   *
   * The hash may carry a trailing `^` (parent commit) — how the frontend
   * fetches a REMOVED file's content, which no longer exists at the commit
   * that deleted it.
   */
  server.get<{
    Params: { hash: string; "*": string };
  }>("/api/history/blob/:hash/*", async (request, reply) => {
    const { hash } = request.params;
    const rawFilePath = request.params["*"];

    if (!/^[\da-f]{6,40}\^?$/i.test(hash) || !rawFilePath) {
      return reply.status(400).send({ error: "Invalid hash or path" });
    }

    // Box namespace fence, checked on the NORMALIZED path (there is no
    // filesystem resolve step here — `git show` treats the path as relative
    // to the repo root, i.e. `boxRoot` — so `path.posix.normalize` plays the
    // role `path.resolve` plays for the fs-backed routes): a traversal form
    // like `_content/../package.json` must not read `package.json` just
    // because the raw string starts with an underscore area
    // (`docs/implemented-plans/one-root-box-layout.md` Track B). This is a
    // CURRENT-vocabulary check on the REQUESTED path — a historical file
    // that lived at a pre-migration v2 path (e.g. `content/inbox/x`) becomes
    // unreachable via this route once its old path no longer parses as an
    // underscore area; that's acceptable (history for a since-migrated box
    // is browsed at its current, post-migration paths).
    const normalized = path.posix.normalize(rawFilePath);
    if (normalized.startsWith("../") || normalized === ".." || !isInBoxNamespace(normalized)) {
      return reply.status(403).send({ error: "Access denied" });
    }
    const filePath = normalized;

    try {
      const git = simpleGit(boxRoot);
      let buffer: Buffer = await git.binaryCatFile(["blob", `${hash}:${filePath}`]);

      // If this is a Git LFS pointer, resolve through smudge filter
      const LFS_PREFIX = "version https://git-lfs.github.com/spec/v1\n";
      if (buffer.length < 200 && buffer.toString("utf-8").startsWith(LFS_PREFIX)) {
        buffer = execFileSync(
          "git", ["lfs", "smudge"],
          { cwd: boxRoot, input: buffer, maxBuffer: 50 * 1024 * 1024 }
        );
      }

      // If this is a git-annex pointer, resolve the key to the object's bytes.
      // Historical blobs hold the pointer text (annex smudge applies to the
      // working tree only), so the key is looked up in the local annex store.
      const annexPointer = parseAnnexPointer(new Uint8Array(buffer));
      if (annexPointer !== null) {
        let objectPath: string;
        try {
          objectPath = execFileSync(
            "git", ["annex", "contentlocation", annexPointer.key],
            { cwd: boxRoot, encoding: "utf-8" }
          ).trim();
        } catch (_e) {
          /* ignore: non-zero exit means the content is not present locally */
          return reply
            .status(409)
            .send({ error: describeAbsentContent(annexPointer, filePath) });
        }
        buffer = fs.readFileSync(path.join(boxRoot, objectPath));
      }

      const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
      const contentType = extensionToMimetype(ext, { fallback: "application/octet-stream" });

      return applyRawFileServingHeaders(
        reply
          .header("Content-Type", contentType)
          .header("Cache-Control", "public, max-age=31536000, immutable"),
        { ext, filename: path.basename(filePath) }
      ).send(buffer);
    } catch (_e) {
      return reply.status(404).send({ error: "File not found in commit" });
    }
  });
}
