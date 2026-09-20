/**
 * The collection runner: five stages, in order, holding no state.
 *
 * 1. **Scope.** `here` and the glob decide which cards are read
 *    (`card-scope.ts` owns the containment guards).
 * 2. **Extract.** Each card's text becomes items — pure, cacheable, no clock.
 * 3. **Derive.** The caller's `DeriveContext` is the only time-dependent
 *    input, and the only place it can enter.
 * 4. **Reference scope.** Cards OUTSIDE the glob contribute just the items
 *    that point into `here`, plus those items' ancestors, marked
 *    `via: "reference"`. There is no reverse index, so this reads the box —
 *    bounded only by `mayHaveItem`, which skips a parse — and
 *    `includeReferring: false` restores the subtree-only scan.
 * 5. **Match, reduce, group.** `rows.ts`.
 *
 * Every consumer of a collection goes through here, so the scope rule is
 * written once instead of in each of them.
 */

import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { buildLoadContext } from "../load-context.js";
import { summarizeCardText } from "../summarize-card.js";
import { errorMessage } from "../../lib/error-guards.js";
import { listScopedCardPaths } from "./card-scope.js";
import { defaultGlobFor, refMatchesHere } from "./here.js";
import { buildGroups, type ScannedCard } from "./rows.js";
import type {
  CollectionDef,
  CollectionIssue,
  CollectionItem,
  CollectionQuery,
  CollectionResult,
  DeriveContext,
  ResolvedQuery,
} from "./types.js";
import type { LoadCardContext } from "../card-io.js";

/** Thrown when a query names a grouping the collection doesn't define. */
class UnknownGroupingError extends Error {
  constructor(collection: string, group: string) {
    super(`collection "${collection}" has no grouping "${group}"`);
    this.name = "UnknownGroupingError";
  }
}

function resolveQuery<Params>(query: CollectionQuery<Params>): ResolvedQuery {
  const here = query.here;
  return {
    here,
    glob: query.glob === undefined || query.glob === "" ? defaultGlobFor(here) : query.glob,
    // Nothing is outside the box, so a box-wide query has no reference pass to
    // run and should not pay for one.
    includeReferring: query.includeReferring ?? here !== "",
    group: query.group ?? "place",
  };
}

export async function runCollection<
  Item extends CollectionItem,
  Derived extends CollectionItem,
  Params,
  Reduction,
>(
  boxRoot: string,
  input: {
    def: CollectionDef<Item, Derived, Params, Reduction>;
    query: CollectionQuery<Params>;
    deriveCtx: DeriveContext;
  },
): Promise<CollectionResult<Derived, Reduction>> {
  const { def, query, deriveCtx } = input;
  const resolved = resolveQuery(query);
  const grouping = def.groupings[resolved.group];
  if (grouping === undefined) throw new UnknownGroupingError(def.name, resolved.group);

  const ctx = await buildLoadContext(boxRoot);
  const issues: CollectionIssue[] = [];
  const cards: Array<ScannedCard<Derived>> = [];

  const scopeAbs = await listScopedCardPaths(boxRoot, resolved.glob);
  const scopeRel = new Set<string>();
  for (const absPath of scopeAbs) {
    const relPath = path.relative(boxRoot, absPath);
    scopeRel.add(relPath);
    const content = await readCard({ absPath, relPath, issues });
    if (content === null) continue;
    const scanned = scan({ def, ctx, deriveCtx, relPath, content });
    issues.push(...scanned.issues);
    cards.push({ relPath, via: "scope", inScope: scanned.items, summary: scanned.summary });
  }

  if (resolved.includeReferring) {
    cards.push(
      ...(await scanReferring({ boxRoot, def, ctx, deriveCtx, here: resolved.here, scopeRel })),
    );
  }

  cards.sort((a, b) => a.relPath.localeCompare(b.relPath));
  const everything = cards.flatMap((card) => card.inScope);
  return {
    query: resolved,
    reduction: def.reduce(everything),
    groups: buildGroups({ def, cards, params: query.params, grouping }),
    issues,
  };
}

async function readCard(input: {
  absPath: string;
  relPath: string;
  issues: CollectionIssue[];
}): Promise<string | null> {
  try {
    return await readFile(input.absPath, "utf8");
  } catch (e) {
    input.issues.push({ kind: "load", path: input.relPath, message: errorMessage(e) });
    return null;
  }
}

function scan<Item extends CollectionItem, Derived extends CollectionItem, Params, Reduction>(input: {
  def: CollectionDef<Item, Derived, Params, Reduction>;
  ctx: LoadCardContext;
  deriveCtx: DeriveContext;
  relPath: string;
  content: string;
}): { items: Derived[]; issues: CollectionIssue[]; summary: () => ReturnType<typeof summarizeCardText> } {
  const { def, ctx, deriveCtx, relPath, content } = input;
  const extracted = def.extract({ relPath, content, ctx });
  const items = extracted.items
    .map((item) => def.derive(item, deriveCtx))
    .toSorted((a, b) => def.compareItems(a, b));
  return {
    items,
    issues: extracted.issues,
    // Built only for a card that earns a row, so a box-wide scan does not
    // summarize every card it looked at.
    summary: () => summarizeCardText({ relPath, content, ctx }),
  };
}

/**
 * Cards outside the glob that point into `here`. They contribute only the
 * items whose refs match, plus those items' ancestors — the rest of such a
 * card is somebody else's business.
 *
 * A card that cannot hold an item is skipped without a parse, and a card that
 * fails to load or parse out here is skipped silently rather than filling a
 * project's view with box-wide noise: an unparseable card cannot be shown to
 * refer to anything, and the scope pass is what owns the issues channel.
 */
async function scanReferring<
  Item extends CollectionItem,
  Derived extends CollectionItem,
  Params,
  Reduction,
>(input: {
  boxRoot: string;
  def: CollectionDef<Item, Derived, Params, Reduction>;
  ctx: LoadCardContext;
  deriveCtx: DeriveContext;
  here: string;
  scopeRel: Set<string>;
}): Promise<Array<ScannedCard<Derived>>> {
  const { boxRoot, def, ctx, deriveCtx, here, scopeRel } = input;
  if (here === "") return [];

  const out: Array<ScannedCard<Derived>> = [];
  for (const absPath of await listScopedCardPaths(boxRoot, "**/*.card")) {
    const relPath = path.relative(boxRoot, absPath);
    if (scopeRel.has(relPath)) continue;
    let content: string;
    try {
      content = await readFile(absPath, "utf8");
    } catch (e) {
      console.warn(`[collection] could not read ${relPath} for the reference pass: ${errorMessage(e)}`);
      continue;
    }
    if (!def.mayHaveItem(content)) continue;
    const scanned = scan({ def, ctx, deriveCtx, relPath, content });
    const inScope = referringItems({ def, items: scanned.items, here });
    if (inScope.length === 0) continue;
    out.push({ relPath, via: "reference", inScope, summary: scanned.summary });
  }
  return out;
}

function referringItems<Item extends CollectionItem, Derived extends CollectionItem, Params, Reduction>(input: {
  def: CollectionDef<Item, Derived, Params, Reduction>;
  items: Derived[];
  here: string;
}): Derived[] {
  const { def, items, here } = input;
  const byKey = new Map(items.map((item) => [def.keyOf(item), item] as const));
  const kept = new Set<string>();
  for (const item of items) {
    if (!def.refsOf(item).some((ref) => refMatchesHere(ref, here))) continue;
    kept.add(def.keyOf(item));
    let parentKey = def.parentKeyOf(item);
    while (parentKey !== null && !kept.has(parentKey)) {
      const parent = byKey.get(parentKey);
      if (parent === undefined) break;
      kept.add(parentKey);
      parentKey = def.parentKeyOf(parent);
    }
  }
  return items.filter((item) => kept.has(def.keyOf(item)));
}
