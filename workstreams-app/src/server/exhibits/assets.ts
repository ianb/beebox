// The compile/serve half of the exhibits origin, behind an interface so the
// routes can be tested without starting a dev server.
//
// The production implementation (vite-assets.ts) is a Vite dev server in
// middleware mode; the routes only need these five operations.

import type http from "node:http";

export interface ExhibitsAssets {
  /** Inject the dev client (and anything else Vite adds) into a shell page. */
  transformIndexHtml(url: string, html: string): Promise<string>;
  /**
   * Compile a page module ahead of serving its shell. In middleware mode Vite
   * swallows transform errors (it logs them and calls next() without the
   * error), so a broken page is only visible as a real error here.
   */
  preflightModule(absPath: string): Promise<void>;
  /**
   * Nothing in the store is in the module graph until it is imported, so the
   * cached Tailwind CSS misses a brand-new exhibit's utilities. Invalidate the
   * stylesheet the first time each exhibit directory is served.
   */
  noticeExhibit(dir: string): void;
  /** Hand a request Fastify did not resolve to the dev server. */
  handle(
    exchange: { req: http.IncomingMessage; res: http.ServerResponse },
    next: (error?: unknown) => void,
  ): void;
  close(): Promise<void>;
}
