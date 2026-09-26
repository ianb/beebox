/**
 * The collection runner: five stages, in order, holding no state.
 *
 * 1. **Scope.** `here` and the glob decide which cards are read
 *    (`card-scope.ts` owns the containment guards). A card is read with
 *    bounded parallelism (`mapInBatches`, `count.ts`'s approach), then
 *    skipped — no items, no issue — when `def.mayHaveItem` says its text
 *    cannot hold one; a card that fails to READ is still an issue. This is
 *    "something better than `**`": the scope is "cards whose text can hold
 *    an item", declared by the collection, not by query syntax.
 * 2. **Extract.** Each card's text becomes items — pure, cacheable, no clock.
 * 3. **Derive.** The caller's `DeriveContext` is the only time-dependent
 *    input, and the only place it can enter. `def.inScope`, when the
 *    collection declares it, runs immediately after — before reduction,
 *    grouping, or the reference pass sees the item at all.
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
import { mapInBatches } from "../../lib/map-batched.js";
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
  // Reads are bounded-parallel (`count.ts`'s approach), but `mapInBatches`
  // returns in input order, so the loop below stays a plain sequential walk —
  // issues and rows land in the same deterministic order the old serial read
  // produced.
  const reads = await mapInBatches(scopeAbs, { size: READ_CONCURRENCY, map: (absPath) => readCard(boxRoot, absPath) });
  for (const read of reads) {
    scopeRel.add(read.relPath);
    if (read.issue !== null) {
      issues.push(read.issue);
      continue;
    }
    // A card whose text cannot hold an item contributes nothing — no items,
    // no issue. It is still readable (the branch above is what an unreadable
    // card takes), so the visible-invalid guarantee only narrows to "a card
    // that CAN hold an item is always reported if it fails to load or parse".
    if (!def.mayHaveItem(read.content)) continue;
    const scanned = scan({ def, ctx, deriveCtx, relPath: read.relPath, content: read.content, params: query.params });
    issues.push(...scanned.issues);
    cards.push({ relPath: read.relPath, via: "scope", inScope: scanned.items, summary: scanned.summary });
  }

  if (resolved.includeReferring) {
    cards.push(
      ...(await scanReferring({ boxRoot, def, ctx, deriveCtx, here: resolved.here, scopeRel, params: query.params })),
    );
  }

  // The place's own cards first, then the cards that merely point into it,
  // each set in path order. Row order is decided here rather than per
  // consumer, so the web list, `bbx query` and `bbx todos` agree — and so a
  // card from elsewhere in the box cannot sort above the project's own work
  // just because its path starts with an earlier letter. `rows.ts` walks
  // `cards` in this order for every group, so the `plate` grouping gets the
  // same rule inside each of its groups.
  cards.sort((a, b) => viaOrder(a.via) - viaOrder(b.via) || a.relPath.localeCompare(b.relPath));
  const everything = cards.flatMap((card) => card.inScope);
  if (def.crossCardIssues !== undefined) issues.push(...def.crossCardIssues(everything));
  return {
    query: resolved,
    reduction: def.reduce(everything),
    groups: buildGroups({ def, cards, params: query.params, grouping }),
    issues,
  };
}

function viaOrder(via: "scope" | "reference"): number {
  return via === "scope" ? 0 : 1;
}

/** Cards read at once — high enough to saturate the filesystem, low enough to bound open handles (`count.ts`'s constant, restated: the two aren't allowed to import each other's internals). */
const READ_CONCURRENCY = 64;

/** One scope-pass card's read outcome: its text, or the issue an unreadable file contributes instead. */
async function readCard(boxRoot: string, absPath: string): Promise<{ relPath: string; content: string; issue: null } | { relPath: string; content: null; issue: CollectionIssue }> {
  const relPath = path.relative(boxRoot, absPath);
  try {
    return { relPath, content: await readFile(absPath, "utf8"), issue: null };
  } catch (e) {
    return { relPath, content: null, issue: { kind: "load", path: relPath, message: errorMessage(e) } };
  }
}

function scan<Item extends CollectionItem, Derived extends CollectionItem, Params, Reduction>(input: {
  def: CollectionDef<Item, Derived, Params, Reduction>;
  ctx: LoadCardContext;
  deriveCtx: DeriveContext;
  relPath: string;
  content: string;
  params: Params;
}): { items: Derived[]; issues: CollectionIssue[]; summary: () => ReturnType<typeof summarizeCardText> } {
  const { def, ctx, deriveCtx, relPath, content, params } = input;
  const extracted = def.extract({ relPath, content, ctx });
  const items = extracted.items
    .map((item) => def.derive(item, deriveCtx))
    // Applied right after derive and before anything downstream sees the
    // item — a card's reduction, its row, and the reference pass's own scope
    // walk all read `items`, so an out-of-scope item excluded here can never
    // resurface in a count or a row.
    .filter((item) => def.inScope === undefined || def.inScope(item, params))
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
  params: Params;
}): Promise<Array<ScannedCard<Derived>>> {
  const { boxRoot, def, ctx, deriveCtx, here, scopeRel, params } = input;
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
    const scanned = scan({ def, ctx, deriveCtx, relPath, content, params });
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
