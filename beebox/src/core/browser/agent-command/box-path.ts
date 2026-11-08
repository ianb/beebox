/**
 * Box paths in `bbx browser` (docs/plans/agent-self-view.md, Track C): an
 * address that starts with one `/`, given to `open` (or its aliases `goto`,
 * `navigate`) or `tab new`, names a page of this box. It is an ordinary
 * relative URL resolved against the box's app URL, not a protocol: the URLs
 * the browser prints back are the real ones, and those pass through unchanged.
 *
 * Upstream gives a bare `/path` no meaning (without a scheme it prepends
 * `https://`), so nothing is shadowed. `//host` is a protocol-relative URL for
 * another site, so it is refused rather than guessed at.
 */

import { appBasePath } from "../app-url.js";
import { nextPositional } from "../exec-args.js";

const NAVIGATE = new Set(["open", "goto", "navigate"]);

export type BoxPathResult = { ok: true; args: string[] } | { ok: false; message: string };

/** The URL of a box page, from the app URL and the box's slug. */
export function boxPageUrl(box: { base: URL; slug: string }, boxPath: string): string {
  return `${box.base.origin}${appBasePath(box.base)}${box.slug}${boxPath}`;
}

/** The index of the address argument, when the command takes one. */
function addressIndex(args: readonly string[]): number | null {
  const command = nextPositional(args, 0);
  if (command === null) return null;
  if (NAVIGATE.has(args[command] ?? "")) return nextPositional(args, command + 1);
  if (args[command] !== "tab") return null;
  const operation = nextPositional(args, command + 1);
  if (operation === null || args[operation] !== "new") return null;
  // `tab new --label <name> [url]`: the label's value is not the address.
  for (let i = nextPositional(args, operation + 1); i !== null; i = nextPositional(args, i + 1)) {
    if (args[i - 1] !== "--label") return i;
  }
  return null;
}

/**
 * Rewrite a box path to its full URL. `app` is the resolved app URL, or the
 * reason there is none (then a box path is refused with that reason).
 */
export function resolveBoxPaths(args: readonly string[], opts: { app: { ok: true; base: URL } | { ok: false; reason: string }; slug: string }): BoxPathResult {
  const index = addressIndex(args);
  const address = index === null ? undefined : args[index];
  if (index === null || address === undefined || !address.startsWith("/")) return { ok: true, args: [...args] };
  if (address.startsWith("//")) {
    return { ok: false, message: `bbx browser: ${address} names another site; a page of this box starts with one /, such as /views/<card path>` };
  }
  if (!opts.app.ok) return { ok: false, message: `bbx browser: cannot open ${address}: ${opts.app.reason}` };
  const out = [...args];
  out[index] = boxPageUrl({ base: opts.app.base, slug: opts.slug }, address);
  return { ok: true, args: out };
}
