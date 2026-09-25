/**
 * What a *collection* is: a staged query over the box's cards whose result
 * several consumers render (`docs/plans/todo-collection.md`, Track 3).
 *
 * The stages are the point, and the types enforce the one rule that matters:
 * `extract` receives no clock, so it stays pure and cacheable, and only
 * `derive` sees a `DeriveContext`. Everything after that — matching,
 * reducing, grouping — is a pure function of derived items.
 *
 * A `CollectionDef` is data about one kind of thing (`core/todo/collection.ts`
 * is the only one today). `run.ts` is the stateless runner that reads it.
 */

import type { z } from "zod";
import type { LoadCardContext } from "../card-io.js";
import type { FileSummary } from "../file-summary.js";

/** The minimum an item carries: the box-relative card it was written in. */
export interface CollectionItem {
  path: string;
}

/**
 * A card that could not fully contribute its items, reported alongside the
 * ones that could — never a silent skip. `kind` is the collection's own
 * vocabulary (`TodoCollectionIssue`'s five kinds, for todos).
 */
export interface CollectionIssue {
  kind: string;
  path: string;
  message: string;
}

/** One card's text, and the schemas to read it with. No clock: this is the pure stage's whole world. */
export interface ExtractInput {
  relPath: string;
  content: string;
  ctx: LoadCardContext;
}

/**
 * Everything time-dependent, supplied by the caller so the runner holds no
 * state. `since` is a box-local calendar-date epoch a caller keeps its own
 * baseline for (the review sweep does); `null` when it has none.
 */
export interface DeriveContext {
  now: Date;
  timeZone: string;
  since: number | null;
}

/** A group's identity, label, and where it sorts. Nothing presentational beyond the label. */
export interface GroupKey {
  key: string;
  label: string;
  order: number;
}

export interface CollectionDef<
  Item extends CollectionItem,
  Derived extends CollectionItem,
  Params,
  Reduction,
> {
  name: string;
  params: z.ZodType<Params, unknown>;
  /** Pure, one card. */
  extract(input: ExtractInput): { items: Item[]; issues: CollectionIssue[] };
  /** Cheap proof a card's text cannot hold an item, so the reference pass can skip it without a parse. */
  mayHaveItem(content: string): boolean;
  derive(item: Item, ctx: DeriveContext): Derived;
  /**
   * Whether a derived item counts at all for this query — applied right
   * after `derive` and before reduction, grouping, or the reference pass's
   * own scope. Undefined means every derived item is in scope. Distinct from
   * `matches`: `matches` decides what a query DISPLAYS (a hidden item still
   * counts in a reduction), while `inScope` decides what a query ever SEES.
   * The todo collection uses it for `scope: "boxholder" | "all"` — an
   * excluded agent follow-up must never reach a reduction, or a header could
   * show a count containing an item the list never renders.
   */
  inScope?(item: Derived, params: Params): boolean;
  matches(item: Derived, params: Params): boolean;
  /** Box-relative paths this item points at, already resolved. */
  refsOf(item: Derived): string[];
  /** Identity within one card — what `parentKeyOf` names. */
  keyOf(item: Derived): string;
  /** The item that gives this one its context, or `null` at the top level. */
  parentKeyOf(item: Derived): string | null;
  /** Canonical order within one card. */
  compareItems(a: Derived, b: Derived): number;
  /** The section an item sits in, outermost first. `[]` for a card with no sections. */
  sectionOf(item: Derived): string[];
  /** Always over ALL in-scope items, so a hidden done item still counts. */
  reduce(items: Derived[]): Reduction;
  /**
   * What only shows up once every card has been read — a duplicate id, say.
   * Runs over every in-scope item and appends to the issues channel, so a
   * cross-card problem stays as visible as a card that failed to load.
   */
  crossCardIssues?(items: Derived[]): CollectionIssue[];
  groupings: Record<string, (item: Derived) => GroupKey>;
}

export interface CollectionQuery<Params> {
  /** Box-relative directory or card path; `""` is the box. */
  here: string;
  /**
   * Default: the subtree of `here`. Typed `| undefined` rather than plain
   * optional so a query built from a zod-optional input (the tRPC router,
   * `bbx query`'s flags) assigns straight through under
   * `exactOptionalPropertyTypes`.
   */
  glob?: string | undefined;
  /** Default true, unless `here` is the box. */
  includeReferring?: boolean | undefined;
  /** A key of `groupings`. Default `"place"`. */
  group?: string | undefined;
  params: Params;
}

/** The query as the runner actually ran it, echoed so a consumer can show what it scanned. */
export interface ResolvedQuery {
  here: string;
  glob: string;
  includeReferring: boolean;
  group: string;
}

export interface CollectionRow<Derived, Reduction> {
  card: FileSummary;
  /** `scope` — the card is inside the glob. `reference` — it is outside, and points into `here`. */
  via: "scope" | "reference";
  /** Over every item of this card that is in scope, matching or not. */
  reduction: Reduction;
  sections: Array<{ path: string[]; reduction: Reduction }>;
  /** The group's matching items from this card, plus the ancestors that give them context. */
  items: Array<Derived & { matching: boolean }>;
}

export interface CollectionGroup<Derived, Reduction> {
  key: string;
  label: string;
  /** Over this group's matching items. */
  reduction: Reduction;
  rows: Array<CollectionRow<Derived, Reduction>>;
}

export interface CollectionResult<Derived, Reduction> {
  query: ResolvedQuery;
  /** Over every in-scope item of every card scanned, including cards with no row. */
  reduction: Reduction;
  groups: Array<CollectionGroup<Derived, Reduction>>;
  issues: CollectionIssue[];
}
