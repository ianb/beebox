/**
 * Server entry point. Run directly to start the Fastify server:
 *   node --import tsx ./src/webapp/server-main.ts [boxDirs...]
 * Supports PORT and HOST env vars (standard Procfile convention).
 *
 * This is kept separate from `server.ts` so that importing the server
 * library (e.g. from the `cb serve` command, or when the CLI is bundled)
 * has no side effects — only running THIS file starts a server.
 */
import path from "node:path";
import { startServer, type BoxSpec } from "./server.js";

const dirs = process.argv.slice(2);
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
const host = process.env.HOST ? process.env.HOST : undefined;

const boxes: BoxSpec[] | undefined =
  dirs.length > 0
    ? dirs.map((dir) => {
        const boxRoot = path.resolve(dir);
        return { slug: path.basename(boxRoot), boxRoot };
      })
    : undefined;

startServer({ port, host, boxes });
