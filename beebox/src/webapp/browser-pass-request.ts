/**
 * Does a request to this box carry its box browser pass, from the box's own
 * pages or a typed navigation (`core/browser/pass.ts`)? The one check the box's
 * auth hook, tRPC context and identity resolver share, so they cannot disagree
 * about the pass.
 */

import type { PassHeaders } from "../core/browser/pass.js";
import { verifyBrowserPass } from "../core/browser/pass.js";
import { appOrigin } from "../core/browser/app-url.js";

export function requestHasBrowserPass(boxRoot: string, headers: PassHeaders): boolean {
  return verifyBrowserPass(boxRoot, { appOrigin: appOrigin(process.env), headers });
}
