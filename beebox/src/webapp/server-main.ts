/**
 * Server entry point. Run directly to start the Fastify server:
 *   node --import tsx ./src/webapp/server-main.ts [boxArgs...]
 * Supports PORT and HOST env vars (standard Procfile convention).
 *
 * Each `boxArg` is either a bare directory (slug defaults to its own
 * basename — the legacy behavior) or `<slug>=<dir>` to set the slug
 * explicitly. The dev router (`bin/router.ts`) always passes the explicit
 * form: a v2 box's content dir basename is always the literal string
 * "content", so the router resolves the meaningful slug itself (the box's
 * package root basename) before spawning this process — see Track G in
 * `docs/implemented-plans/boxes-as-packages-v2.md`.
 *
 * This is kept separate from `server.ts` so that importing the server
 * library (e.g. from the `bbx serve` command, or when the CLI is bundled)
 * has no side effects — only running THIS file starts a server.
 */
import path from "node:path";
import { startServer, type BoxSpec } from "./server.js";
import { loadEnv, serverEnvSchema } from "../lib/env.js";
import { boxSlug } from "../lib/box-slug.js";

// Validate + type the environment before anything reads it (Track D.8): a
// malformed PORT/HOST/secret fails here, loudly and all-at-once, with secret
// values redacted — not as a confusing downstream error.
const env = loadEnv(serverEnvSchema);

const boxArgs = process.argv.slice(2);
const port = env.PORT;
const host = env.HOST;

async function parseBoxArg(arg: string): Promise<BoxSpec> {
  const eq = arg.indexOf("=");
  if (eq === -1) {
    const boxRoot = path.resolve(arg);
    return { slug: await boxSlug(boxRoot), boxRoot };
  }
  return { slug: arg.slice(0, eq), boxRoot: path.resolve(arg.slice(eq + 1)) };
}

const boxes: BoxSpec[] | undefined =
  boxArgs.length > 0 ? await Promise.all(boxArgs.map(parseBoxArg)) : undefined;

startServer({ port, host, boxes, devSurfaces: env.BBX_DEV_SURFACES === "1" }).catch((err: unknown) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
