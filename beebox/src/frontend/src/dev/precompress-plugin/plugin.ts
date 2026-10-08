/**
 * Vite plugin: writes a brotli-compressed copy (`<file>.br`, quality 11) of
 * every text asset the build emits under `assets/`.
 *
 * The hub serves these to clients that accept brotli
 * (`src/webapp/static-cache.ts`). Compressing on the fly, as the CDN in front
 * of production does, uses a fast low level: the entry script arrived at
 * about 560 KB, against about 450 KB at quality 11. Quality 11 is too slow to
 * run per request, but it runs once per build, on several files at once.
 * Source maps are skipped; only developer tools fetch them. Build only.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants } from "node:zlib";
import type { Plugin } from "vite";

const compress = promisify(brotliCompress);
const COMPRESSIBLE = /^assets\/.+\.(?:js|mjs|css|svg|json|wasm)$/;

export function precompressPlugin(): Plugin {
  let outDir = "dist";
  return {
    name: "bbx-precompress",
    apply: "build",
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    async writeBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((name) => COMPRESSIBLE.test(name));
      await Promise.all(files.map(async (name) => {
        const path = join(outDir, name);
        const source = await readFile(path);
        const compressed = await compress(source, {
          params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: source.length },
        });
        await writeFile(`${path}.br`, compressed);
      }));
    },
  };
}
