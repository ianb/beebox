/**
 * Lint for a ref's `#anchor` that its target card does not have.
 *
 * Only a plain id fragment on a `.card` with a body is checked. `page=3`,
 * `:~:text=` and `/Section` fragments mean something else, and a target with
 * no body has no anchors to compare against. The target's anchors are read
 * once per `lintCardsDispatch` run and memoized on that run's options object.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { parseRef } from "../../../shared/ref-path/core.js";
import { anchorsIn } from "../../../shared/markdoc-config/anchors.js";
import { errnoCode } from "../../../shared/error-guards.js";
import { resolveContainedRef } from "../../ref-exists.js";

const ID_FRAGMENT = /^[\dA-Za-z][\w-]*$/;

/** Target path (absolute) → its anchor ids, or null when there is nothing to check against. */
const runAnchors = new WeakMap<object, Map<string, Promise<ReadonlySet<string> | null>>>();

function targetAnchors(input: { target: string; run: object }): Promise<ReadonlySet<string> | null> {
  let cache = runAnchors.get(input.run);
  if (cache === undefined) {
    cache = new Map();
    runAnchors.set(input.run, cache);
  }
  const cached = cache.get(input.target);
  if (cached !== undefined) return cached;
  const read = fs.readFile(input.target, "utf-8").then(
    (text) => {
      const { body } = splitCardContent(text);
      return body.trim() === "" ? null : new Set(anchorsIn(body).map((anchor) => anchor.id));
    },
    (e: unknown) => {
      if (errnoCode(e) === "ENOENT" || errnoCode(e) === "EISDIR") return null;
      throw e;
    },
  );
  cache.set(input.target, read);
  return read;
}

/** The warning text for a ref naming an anchor its target lacks, or null when there is nothing to report. */
export async function brokenAnchorMessage(input: {
  ref: string;
  refPath: string;
  fromPath: string;
  boxRoot: string;
  run: object;
}): Promise<string | null> {
  const { fragment, path: refTarget } = parseRef(input.ref);
  if (fragment === undefined || !ID_FRAGMENT.test(fragment) || !refTarget.endsWith(".card")) return null;
  const contained = resolveContainedRef({ ref: input.ref, fromPath: input.fromPath, boxRoot: input.boxRoot });
  if (contained === null) return null;
  const anchors = await targetAnchors({ target: path.resolve(input.boxRoot, contained), run: input.run });
  if (anchors === null || anchors.has(fragment)) return null;
  return `Broken anchor at ${input.refPath}: ${input.ref} — ${contained} has no heading or {% #id %} named "${fragment}"`;
}
