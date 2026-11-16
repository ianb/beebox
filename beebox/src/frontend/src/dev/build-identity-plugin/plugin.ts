/**
 * Vite plugin: stamps the frontend build identity into the built `index.html`
 * as `<meta name="bbx-frontend-build" content="…">` (`shared/frontend-build.ts`).
 *
 * The identity hashes the document Vite produced and the sorted names of every
 * emitted file. Vite puts a content hash in each asset name, so any change to
 * the shipped code or styles changes a name, and an unchanged frontend
 * rebuilds to the same identity (checked 2026-11-16: two builds of one tree
 * gave the same names and document). Build only: the dev server has no
 * bundle, and Vite's own client reloads stale dev tabs.
 */
import { createHash } from "node:crypto";
import type { IndexHtmlTransformResult, Plugin } from "vite";
import { FRONTEND_BUILD_META_NAME } from "../../../../shared/frontend-build.js";

/** The 16-hex identity for one build's document and emitted file names. */
export function frontendBuildIdentity(input: { html: string; fileNames: readonly string[] }): string {
  const hash = createHash("sha256").update(input.html);
  for (const name of input.fileNames.toSorted()) hash.update(`\n${name}`);
  return hash.digest("hex").slice(0, 16);
}

/** The `transformIndexHtml` step, separate so a test can run it on a fake bundle. */
export function stampBuildIdentity(html: string, bundle: Readonly<Record<string, unknown>> | undefined): IndexHtmlTransformResult {
  const identity = frontendBuildIdentity({ html, fileNames: Object.keys(bundle ?? {}) });
  return [{ tag: "meta", attrs: { name: FRONTEND_BUILD_META_NAME, content: identity }, injectTo: "head" }];
}

export function buildIdentityPlugin(): Plugin {
  return {
    name: "bbx-build-identity",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) => stampBuildIdentity(html, ctx.bundle),
    },
  };
}
