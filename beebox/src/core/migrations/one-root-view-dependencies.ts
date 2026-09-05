/**
 * View `dependencies` glob rewriting for the `one-root` migration — split
 * out of `one-root-ref-rewrite.ts` (Track E, step 5) purely to keep that
 * file under the repo's 300-line budget. `rewriteOneRootViewRefs`
 * (`one-root-ref-rewrite.ts`) only rewrites `cardRef="…"` attributes; a
 * view's exported `dependencies` array carries plain glob strings that need
 * a different treatment — mapping each entry's STATIC prefix through the
 * v2→v3 table and splicing the original glob suffix back on unchanged (a
 * dependency glob is used directly as a `glob()` cwd-relative pattern,
 * never in the leading-`/` canonical ref form the other rewriters produce).
 */

import { mapV2Path } from "./one-root-mapping.js";
import { OneRootPreflightError } from "./one-root-errors.js";

const GLOB_METACHAR = /[*?[{]/;
const DEPENDENCIES_HEAD = /export\s+const\s+dependencies\s*(?::[^=]+)?=\s*\[/;
const STRING_LITERAL = /(["'])((?:(?!\1)[^\\]|\\.)*)\1/g;

/**
 * Round-8 hardening finding 5: the old extraction regex captured the array
 * body as `[^\]]*` — everything up to the FIRST `]` — which closes early on a
 * glob CHARACTER CLASS inside a quoted entry (`"store/recipes/[AB]*.recipe.card"`
 * has its own `]`), silently truncating the body the rewriter/gate then read.
 * This walks `text` from the `dependencies = [` head one character at a time,
 * tracking whether it's inside a quoted string (honoring `\`-escapes), and
 * only treats an UNQUOTED `]` as the array's real close.
 *
 * Returns `null` when there's no `dependencies` declaration at all (nothing
 * to do, not an error). Throws naming `viewRelPath` when a declaration IS
 * found but no close can be located before EOF — fail closed rather than
 * guess at the array's extent the way the old regex did.
 */
function findDependenciesArray(text: string, viewRelPath: string): { bodyStart: number; bodyEnd: number } | null {
  const head = DEPENDENCIES_HEAD.exec(text);
  if (head === null) return null;
  const bodyStart = head.index + head[0].length;
  let quote: string | null = null;
  for (let i = bodyStart; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "]") return { bodyStart, bodyEnd: i };
  }
  throw new OneRootPreflightError(
    `${viewRelPath}: "dependencies" array declaration has no closing "]" this migration can find — refusing ` +
      'to guess at its extent (a glob character class\'s own "]" can look like the array\'s closing bracket to ' +
      "a naive scan). Reconcile by hand, then re-run.",
  );
}

/**
 * Every literal string entry in a view source's exported `dependencies`
 * array, in source order. Shared with {@link OneRootLinkGateResult}'s
 * dependency-prefix check (`one-root-link-gate.ts`) so the rewriter and the
 * gate that double-checks its output read the exact same grammar.
 */
export function extractDependencyGlobs(text: string, viewRelPath: string): string[] {
  const found = findDependenciesArray(text, viewRelPath);
  if (found === null) return [];
  const body = text.slice(found.bodyStart, found.bodyEnd);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  STRING_LITERAL.lastIndex = 0;
  while ((m = STRING_LITERAL.exec(body)) !== null) {
    if (m[2] !== undefined) out.push(m[2]);
  }
  return out;
}

/** Split a dependency glob into its static directory prefix (everything
 * before the first glob metacharacter, trimmed back to the previous `/`) and
 * the remaining suffix (kept byte-for-byte, including its leading `/`). An
 * empty prefix means the pattern has no static directory context at all
 * (e.g. `**\/*.card`) — nothing to resolve confidently. */
export function staticGlobPrefix(pattern: string): { prefix: string; suffix: string } {
  const idx = pattern.search(GLOB_METACHAR);
  if (idx === -1) return { prefix: pattern, suffix: "" };
  const cut = pattern.lastIndexOf("/", idx);
  const prefix = cut === -1 ? "" : pattern.slice(0, cut);
  return { prefix, suffix: pattern.slice(prefix.length) };
}

/** The v3 top-level "area" a moved path lands under — its first path
 * segment. Used to detect a v2 static PREFIX whose subtree crosses more than
 * one v3 area (round-8 hardening finding 6, below). */
function areaOf(newPath: string): string {
  const slash = newPath.indexOf("/");
  return slash === -1 ? newPath : newPath.slice(0, slash);
}

/**
 * Round-8 hardening finding 6: every v3 area a v2 static directory PREFIX's
 * subtree can land in — probed by feeding {@link mapV2Path} itself synthetic
 * children, one per literal case the mapping table's own switches recognize
 * at the places a v2 prefix's subtree splits across more than one v3 area:
 * `box/*` (`_content`/`_bookkeeping`/`_publish`), `store/*`
 * (`_content`/`_bookkeeping`), and `config/connectors/*` (`_config`, except
 * a `*.state.json` FILE, which lands in `_bookkeeping/connectors`). A prefix
 * this finds more than one area for is a split IN THE MAPPING TABLE ITSELF,
 * not a guess — `store/**` cannot assume every match it selects lands in one
 * place post-migration, and neither can `config/connectors/*.state.json`'s
 * own static directory prefix.
 */
function areasUnderPrefix(prefix: string): string[] {
  const normalized = prefix.replace(/\/+$/, "");
  if (normalized === "") return ["_content", "_bookkeeping", "_publish", "_config", "src", ".claude"];
  const connectorsPrefix = normalized === "config" ? "config/connectors" : normalized;
  const probes: readonly string[] =
    normalized === "box"
      ? ["box/inbox/x", "box/jobs/x", "box/output/x", "box/questions/x", "box/resources/x", "box/publish/x"]
      : normalized === "store"
        ? [
            "store/archive/x",
            "store/trash/x",
            "store/usage/x",
            "store/recipes/x",
            "store/todos/x",
            "store/drive/x",
            "store/calendar/x",
            "store/chat/x",
            "store/reviews/x",
            "store/other/x",
          ]
        : normalized === "config" || normalized === "config/connectors"
          ? [`${connectorsPrefix}/x.json`, `${connectorsPrefix}/x.state.json`]
          : [];
  if (probes.length === 0) {
    const direct = mapV2Path(normalized);
    return direct.kind === "move" ? [areaOf(direct.newPath)] : [];
  }
  const areas = new Set<string>();
  for (const probe of probes) {
    const mapped = mapV2Path(probe);
    if (mapped.kind === "move") areas.add(areaOf(mapped.newPath));
  }
  return [...areas];
}

/**
 * Round-7 hardening finding 4: a view's exported `dependencies` array
 * (`["store/recipes/**\/*.card"]`) carries plain glob strings that
 * `rewriteOneRootViewRefs` (`one-root-ref-rewrite.ts`) never touches — that
 * function only rewrites `cardRef="…"` attributes. Left alone, a v2
 * dependency glob survives the migration verbatim, and since the directory
 * it named just moved, it matches nothing post-migration — a view that
 * silently renders empty rather than a ref the hard link gate can catch (a
 * dependency glob is not a ref).
 *
 * Maps each entry's STATIC prefix (the part before the first glob
 * metacharacter) through the same v2→v3 table every other path goes through
 * and splices the original glob suffix back on unchanged — a dependency glob
 * is used directly as a `glob()` cwd-relative pattern (`core/views/cards.ts`),
 * never in the leading-`/` canonical ref form the other rewriters produce.
 *
 * Fails CLOSED: a prefix `mapV2Path` can't resolve — including the
 * degenerate empty-prefix case (no static directory context at all) — throws
 * naming `viewRelPath` AND the offending glob, rather than leave a migrated
 * box with a dependency nobody can be sure still matches the right thing.
 * Same stance for a prefix whose subtree crosses more than one v3 area
 * (finding 6): the migration can't confidently rewrite a glob it can't be
 * sure lands in one place, so it aborts naming both destination areas rather
 * than picking one and silently losing the other's matches.
 */
export function rewriteOneRootViewDependencies(
  text: string,
  viewRelPath: string,
): { text: string; rewritten: number } {
  let rewritten = 0;
  const found = findDependenciesArray(text, viewRelPath);
  if (found === null) return { text, rewritten };
  const body = text.slice(found.bodyStart, found.bodyEnd);
  const newBody = body.replace(STRING_LITERAL, (...innerArgs: string[]) => {
    const [, quote, value] = innerArgs;
    const { prefix, suffix } = staticGlobPrefix(value ?? "");
    const areas = prefix === "" ? [] : areasUnderPrefix(prefix);
    if (areas.length > 1) {
      throw new OneRootPreflightError(
        `${viewRelPath}: dependency glob "${value}" spans more than one v3 area under "${prefix}" ` +
          `(${areas.join(", ")}) — the migration can't assume every match it selects lands in the same place. ` +
          "Split the glob into one pattern per destination area, then re-run.",
      );
    }
    const mapped = prefix === "" ? null : mapV2Path(prefix);
    if (mapped === null || mapped.kind !== "move") {
      throw new OneRootPreflightError(
        `${viewRelPath}: dependency glob "${value}" has no confidently-mappable static directory prefix — ` +
          "refusing to migrate rather than leave a dependency that may match the wrong thing (or nothing) " +
          "post-migration. Reconcile by hand, then re-run.",
      );
    }
    rewritten++;
    return `${quote}${mapped.newPath}${suffix}${quote}`;
  });
  return { text: text.slice(0, found.bodyStart) + newBody + text.slice(found.bodyEnd), rewritten };
}
