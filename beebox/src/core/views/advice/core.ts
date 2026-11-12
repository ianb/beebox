/**
 * `bbx view check` advice for one view: the source rules (`source.ts`) over
 * the view and every local file it imports (`../local-imports.ts`), and the
 * DOM rules (`dom.ts`) over each check state's settled HTML, rebuilt in
 * jsdom. Runs in the `bbx view advise` child, whose parent kills it at its
 * timeout: the parser is a synchronous pipe to a Go process, so nothing in
 * this process could interrupt a parse.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileSpecifiers, localImportClosure } from "../local-imports.js";
import { mergeAdvice, type ViewAdvice } from "./types.js";
import { sourceAdvice } from "./source.js";
import { domAdvice } from "./dom.js";

// The advice record, for the CLI: this file is the directory's one entry.
export { mergeAdvice, viewAdviceSchema, type ViewAdvice } from "./types.js";

/**
 * Advice for the view at `viewAbsPath` and its local imports under `root`
 * (the views directory); each `where` is `views/<path under root>:<line>`.
 */
export async function viewSourceAdvice(viewAbsPath: string, { root }: { root: string }): Promise<ViewAdvice[]> {
  const ts = await import("../../../lib/typescript/syntax.js");
  const parser = ts.createParser();
  const syntax = { ts, parse: parser.parse };
  try {
    const realRoot = await fs.realpath(root);
    const files = await localImportClosure(viewAbsPath, {
      root,
      listSpecifiers: (file) => fileSpecifiers(ts, parser.parse({ fileName: path.basename(file.path), sourceText: file.source })),
    });
    const found = files.flatMap((file) => sourceAdvice(syntax, { fileName: `views/${path.relative(realRoot, file.path)}`, source: file.source }));
    return mergeAdvice(found);
  } finally {
    parser.close();
  }
}

/**
 * DOM advice for one settled render: `html` was the container's content and
 * `headStyles` the `<style>` elements in the head. jsdom runs no scripts by
 * default, so nothing in the HTML runs.
 */
export async function renderedAdvice({ html, headStyles }: { html: string; headStyles: readonly string[] }): Promise<ViewAdvice[]> {
  const { JSDOM, VirtualConsole } = await import("jsdom");
  const dom = new JSDOM(`<!doctype html><html><head>${headStyles.join("")}</head><body><div>${html}</div></body></html>`, { virtualConsole: new VirtualConsole() });
  try {
    const container = dom.window.document.body.firstElementChild;
    return container === null ? [] : domAdvice(container);
  } finally {
    dom.window.close();
  }
}
