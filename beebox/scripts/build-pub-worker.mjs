import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(scriptDir, "..");

export async function buildPublicationWorker() {
  await build({
    entryPoints: [path.join(root, "pub-worker/src/index.ts")],
    outfile: path.join(root, "dist/pub-worker.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    logLevel: "warning",
  });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPublicationWorker();
}
