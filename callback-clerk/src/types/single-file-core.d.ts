/**
 * Minimal types for single-file-core's entry module. The package ships no
 * type declarations and no `exports` map; we deep-import the one function we
 * need. `getPageData` runs SingleFile against a document and returns the
 * self-contained page as `content` (a single HTML string) when
 * `compressContent` is not set.
 *
 * See `src/platform/freeze-page.ts`.
 */
declare module "single-file-core/single-file.js" {
  export interface SingleFilePageData {
    content: string;
    title?: string;
  }
  // The real export takes (options, initOptions, doc, win); we only ever pass
  // options and let it default doc/win to the content script's globals.
  export function getPageData(options?: Record<string, unknown>): Promise<SingleFilePageData>;
}
