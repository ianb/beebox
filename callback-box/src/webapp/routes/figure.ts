/**
 * Route for compiling a figure card's source attachment.
 *
 *   GET /api/figure/module.js?path=<box-relative .ts in an attach scope>
 *
 * A figure card's runnable source lives in its `<basename>.attach/` scope; the
 * frontend resolves the card's `entry` against the card path and passes the
 * resolved box-relative path here. We compile it with the shared esbuild view
 * compiler (`bundleView`), externalizing the runtime libraries — the harness
 * provides `p5`/`three`/`d3` to the sketch, which must not import them.
 *
 * On a compile error we return a figure-shaped module exporting
 * `figureError` (a string), NOT the views route's React error component — the
 * figure harness invokes `default` as a `(lib, mount, figure)` factory, so a
 * React component there would be miscalled. The harness checks `figureError`
 * first.
 */

import type { FastifyInstance } from "fastify";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { bundleView } from "../views/compiler.js";
import { cardBasename } from "../../shared/attach-path.js";

/**
 * Runtime libraries the harness injects into a sketch. Externalized so a stray
 * `import` resolves to nothing at bundle time (failing loudly at load) rather
 * than bundling a duplicate copy into every figure.
 */
const FIGURE_EXTERNALS = ["p5", "three", "d3"];

interface RegisterFigureRoutesOptions {
  server: FastifyInstance;
  boxRoot: string;
}

/** A module the figure harness recognizes as a compile failure. */
function figureErrorModule(message: string): string {
  return `export const figureError = ${JSON.stringify(message)};\n`;
}

async function hasOwningCard(sourcePath: string, root: string): Promise<boolean> {
  const relative = path.relative(root, sourcePath);
  const segments = relative.split(path.sep);
  const attachIndex = segments.findIndex((segment) => segment.endsWith(".attach"));
  if (attachIndex === -1) return false;
  const attachName = segments[attachIndex];
  if (attachName === undefined) return false;
  const ownerStem = attachName.slice(0, -".attach".length);
  const parent = path.join(root, ...segments.slice(0, attachIndex));
  const entries = await fs.readdir(parent);
  return entries.some((entry) => entry.endsWith(".card") && cardBasename(entry).toLowerCase() === ownerStem.toLowerCase());
}

export function registerFigureRoutes(options: RegisterFigureRoutesOptions): void {
  const { server, boxRoot } = options;

  server.get<{ Querystring: { path?: string } }>(
    "/api/figure/module.js",
    async (request, reply) => {
      const reqPath = request.query.path ?? "";
      if (reqPath === "") {
        return reply.status(400).send({ error: "Missing ?path" });
      }

      // Security: resolve and ensure within boxRoot. Compare against `root +
      // sep` (not a bare prefix) so a sibling dir like `<box>-secrets` can't
      // satisfy the check.
      const resolved = path.resolve(path.join(boxRoot, reqPath));
      const root = path.resolve(boxRoot);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        return reply.status(400).send({ error: "Path outside box" });
      }

      // A figure's code lives in `<card>.attach/…` and is TypeScript — refuse to
      // compile a loose box file as a module, so this endpoint can't be turned
      // into a general code server for arbitrary box paths.
      const ext = path.extname(resolved);
      const inAttachScope = resolved.split(path.sep).some((seg) => seg.endsWith(".attach"));
      if (!inAttachScope || (ext !== ".ts" && ext !== ".tsx")) {
        return reply
          .status(400)
          .send({ error: "Not a figure source (.ts/.tsx in an attach scope)" });
      }

      // Resolve symlinks before trusting the path. The containment check above
      // guards only the *literal* path, but stat/read/compile follow symlinks —
      // a symlink inside an attach dir pointing outside the box (or at a loose
      // in-box file) would otherwise escape both the box-containment and the
      // figure-source guards and leak file contents. realpath canonicalizes
      // every segment; a dangling symlink or absent file throws → a clean 404.
      //
      // TOCTOU note: a path component swapped between this realpath and the
      // compile below would let bundleView read a different target than the one
      // validated. Accepted for a single-owner box (the box is not a multi-tenant
      // host and figure entries are authored in-box, not synced from outside);
      // closing it fully would need an fd-based read esbuild doesn't offer here.
      let realResolved: string;
      let realRoot: string;
      try {
        realResolved = await fs.realpath(resolved);
        realRoot = await fs.realpath(root);
      } catch (_e) {
        // Absent path or dangling symlink — a 404, distinct from a compile
        // error, carrying no detail beyond "missing".
        return reply.status(404).send({ error: "Source not found" });
      }

      // Re-run containment AND the figure-source guard on the REAL path: a
      // symlink's target must itself be an in-box `.ts`/`.tsx` in an attach
      // scope, or it is refused before any read/compile.
      if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
        return reply.status(400).send({ error: "Path outside box" });
      }
      const realExt = path.extname(realResolved);
      const realInAttachScope = realResolved.split(path.sep).some((seg) => seg.endsWith(".attach"));
      if (!realInAttachScope || (realExt !== ".ts" && realExt !== ".tsx")) {
        return reply
          .status(400)
          .send({ error: "Not a figure source (.ts/.tsx in an attach scope)" });
      }
      if (!(await hasOwningCard(realResolved, realRoot))) {
        return reply.status(400).send({ error: "Attach scope has no owning card" });
      }

      let isFile = false;
      try {
        const stat = await fs.stat(realResolved);
        isFile = stat.isFile();
      } catch (_e) {
        // stat throwing means the path is absent — a 404, distinct from a
        // compile error. The error carries no detail beyond "missing".
        isFile = false;
      }
      if (!isFile) {
        return reply.status(404).send({ error: "Source not found" });
      }

      try {
        // cache: false — always reflect current disk state. bundleView's
        // mtime+size cache misses same-tick same-length edits and never notices
        // an edited *imported* helper (it keys on the entry's stat only); a
        // single-file sketch recompiles in milliseconds, and FigureView only
        // fetches on mount + file-change (not polled), so freshness beats reuse.
        const { output } = await bundleView(realResolved, { external: FIGURE_EXTERNALS, cache: false });
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(output);
      } catch (e) {
        // The message may include the offending source line — intended: on a
        // single-owner box the figure's author is its viewer, so the compile
        // error is debugging feedback, not a cross-tenant content leak.
        const message = e instanceof Error ? e.message : String(e);
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(figureErrorModule(message));
      }
    }
  );
}
