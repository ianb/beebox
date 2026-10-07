/**
 * Vite plugin: adds `<link rel="modulepreload">` to the built `index.html`
 * for the chunks `main/app.tsx` imports before React's first render.
 *
 * `main/app.tsx` awaits a dynamic import of `file-types/builtins.tsx` before
 * it renders (see the comment there for why it is dynamic). Without a hint
 * the browser asks for that chunk only after the whole entry script has
 * downloaded and run, which adds a round trip to every first load. The hint
 * lets it download alongside the entry script. Build only: the dev server
 * serves modules unbundled.
 */
import type { Plugin } from "vite";

/** Source modules (relative to the frontend root) whose chunks boot awaits. */
const BOOT_DYNAMIC_IMPORTS = ["src/file-types/builtins.tsx"];

class BootChunkMissingError extends Error {
  constructor(source: string) {
    super(`boot-preload: no chunk is built from ${source}; update BOOT_DYNAMIC_IMPORTS in src/dev/boot-preload-plugin/plugin.ts`);
    this.name = "BootChunkMissingError";
  }
}

export function bootPreloadPlugin(): Plugin {
  let base = "/";
  let root = "";
  return {
    name: "bbx-boot-preload",
    apply: "build",
    configResolved(config) {
      base = config.base;
      root = config.root;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const chunks = Object.values(ctx.bundle ?? {}).filter((item) => item.type === "chunk");
        return BOOT_DYNAMIC_IMPORTS.map((source) => {
          const chunk = chunks.find((c) => c.facadeModuleId === `${root}/${source}`);
          if (chunk === undefined) throw new BootChunkMissingError(source);
          return { tag: "link", attrs: { rel: "modulepreload", crossorigin: true, href: `${base}${chunk.fileName}` }, injectTo: "head" };
        });
      },
    },
  };
}
