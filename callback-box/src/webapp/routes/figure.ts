/**
 * Route for compiling a figure card's source attachment.
 *
 *   GET /api/figure/module.js?path=<box-relative .ts in an attach scope>
 *
 * A figure card's runnable source lives in its `<basename>.attach/` scope; the
 * frontend resolves the card's `entry` against the card path and passes the
 * resolved box-relative path here. We compile it with the shared esbuild view
 * compiler (`compileView`), externalizing the runtime libraries — the harness
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
import { compileView } from "../views/compiler.js";

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

      let isFile = false;
      try {
        const stat = await fs.stat(resolved);
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
        const { output } = await compileView(resolved, { external: FIGURE_EXTERNALS });
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(output);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return reply
          .header("Content-Type", "application/javascript")
          .header("Cache-Control", "no-cache")
          .send(figureErrorModule(message));
      }
    }
  );
}
