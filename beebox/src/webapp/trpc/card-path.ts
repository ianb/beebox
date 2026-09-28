/**
 * Card path resolution shared by more than one `trpc/routers/` member
 * (`card.ts` and `todos.ts`) — set infrastructure, so it lives at the set's
 * parent (rule 3, `docs/plans/file-layout.md`) rather than inside either
 * member.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { TRPCError } from "@trpc/server";
import { boxRelativePath } from "../../shared/box-path.js";
import { resolveBoxNamespacePathOnDisk, type BoxNamespaceAccessMode } from "../../lib/box-namespace-resolve.js";

/**
 * Box containment + namespace fence, checked on the RESOLVED path (both
 * lexically and on disk — the one-root layout means a symlinked directory or
 * leaf could otherwise walk the fence into the package internals). `card.get`
 * and its siblings (`inboundRefs`, `trash`) all resolve through here, and a
 * traversal form like `_content/../package.json` must not read
 * `package.json` just because the raw string starts with an underscore area
 * (`docs/implemented-plans/one-root-box-layout.md` Track B).
 */
export async function resolveCardPath({
  boxRoot,
  inputPath,
  mode,
}: {
  boxRoot: string;
  inputPath: string;
  mode: BoxNamespaceAccessMode;
}): Promise<{ relPath: string; fullPath: string }> {
  const ns = await resolveBoxNamespacePathOnDisk({
    boxRoot,
    rawPath: boxRelativePath(inputPath),
    mode,
  });
  if (!ns.ok) {
    if (ns.reason === "display-form") {
      // Display-form leak (docs/plans/display-path-guard.subplan.md): a
      // caller-visible message naming the canonical form.
      throw new TRPCError({ code: "BAD_REQUEST", message: ns.message });
    }
    // "Did you mean `/_content/<path>`?" — suggestion-on-failure for the
    // boxholder's BARE display vocabulary. A bare content path
    // (`recipes/Soup.recipe.card`) reads to a boxholder as "the box's
    // content", but `card.get`'s `path` input is canonical — a bare path
    // with no area prefix is refused here as an escape (it names nothing
    // inside any underscore area) even though `/_content/<path>` exists.
    // This is already the diagnostic boundary that has `boxRoot` in hand
    // and is about to refuse anyway, so the one extra probe is cheap.
    const bare = boxRelativePath(inputPath);
    const suggestion = bare.startsWith("_") ? null : await suggestContentFormCardPath(boxRoot, bare);
    const suffix = suggestion === null ? "" : ` — did you mean \`${suggestion}\`?`;
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid card path${suffix}` });
  }
  return { relPath: ns.relativePath, fullPath: ns.resolved };
}

/**
 * Whether `_content/<relPath>` exists, for {@link resolveCardPath}'s
 * suggestion — the returned path is the canonical leading-`/` ref form, not
 * the bare box-relative form used for the filesystem check.
 */
async function suggestContentFormCardPath(boxRoot: string, relPath: string): Promise<string | null> {
  const candidate = `_content/${relPath}`;
  try {
    await fs.access(path.join(boxRoot, candidate));
    return `/${candidate}`;
  } catch (_e) {
    return null;
  }
}
