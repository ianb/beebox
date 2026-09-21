/**
 * Turning scanned cards into the result's groups and rows.
 *
 * Two sets per card do all the work: every item in scope, and the subset the
 * query matches. Reductions read the first — a done item that the filter hides
 * still counts toward "5 of 7" — while `items` carries the second plus the
 * ancestors that give it context, each marked. A card with no matching item
 * has no row at all.
 */

import type {
  CollectionDef,
  CollectionGroup,
  CollectionItem,
  CollectionRow,
} from "./types.js";
import type { FileSummary } from "../file-summary.js";

export interface ScannedCard<Derived> {
  relPath: string;
  via: "scope" | "reference";
  /** Every derived item of this card that the scope admits, in canonical order. */
  inScope: Derived[];
  summary: () => FileSummary;
}

/** Build every group of the requested grouping, each with its rows, in group order then path order. */
export function buildGroups<Item extends CollectionItem, Derived extends CollectionItem, Params, Reduction>(input: {
  def: CollectionDef<Item, Derived, Params, Reduction>;
  cards: Array<ScannedCard<Derived>>;
  params: Params;
  grouping: (item: Derived) => { key: string; label: string; order: number };
}): Array<CollectionGroup<Derived, Reduction>> {
  const { def, cards, params, grouping } = input;

  const order = new Map<string, { label: string; order: number }>();
  // key -> card relPath -> the group's matching items from that card
  const byGroup = new Map<string, Map<string, Derived[]>>();

  for (const card of cards) {
    for (const item of card.inScope) {
      if (!def.matches(item, params)) continue;
      const group = grouping(item);
      if (!order.has(group.key)) order.set(group.key, { label: group.label, order: group.order });
      const perCard = byGroup.get(group.key) ?? new Map<string, Derived[]>();
      byGroup.set(group.key, perCard);
      const list = perCard.get(card.relPath) ?? [];
      list.push(item);
      perCard.set(card.relPath, list);
    }
  }

  const groups: Array<CollectionGroup<Derived, Reduction>> = [];
  for (const [key, meta] of order) {
    const perCard = byGroup.get(key) ?? new Map<string, Derived[]>();
    const matching: Derived[] = [];
    const rows: Array<CollectionRow<Derived, Reduction>> = [];
    for (const card of cards) {
      const items = perCard.get(card.relPath);
      if (items === undefined || items.length === 0) continue;
      matching.push(...items);
      rows.push(buildRow({ def, card, matching: items }));
    }
    groups.push({ key, label: meta.label, reduction: def.reduce(matching), rows });
  }
  return groups.toSorted((a, b) => orderOf(order, a.key) - orderOf(order, b.key));
}

function orderOf(order: Map<string, { order: number }>, key: string): number {
  return order.get(key)?.order ?? 0;
}

function buildRow<Item extends CollectionItem, Derived extends CollectionItem, Params, Reduction>(input: {
  def: CollectionDef<Item, Derived, Params, Reduction>;
  card: ScannedCard<Derived>;
  matching: Derived[];
}): CollectionRow<Derived, Reduction> {
  const { def, card, matching } = input;
  const byKey = new Map(card.inScope.map((item) => [def.keyOf(item), item] as const));
  const shown = new Map<string, { item: Derived; matching: boolean }>();

  for (const item of matching) {
    shown.set(def.keyOf(item), { item, matching: true });
    // An item whose parent the filter hides is still nested under it: the
    // parent comes along as context, marked, rather than the child floating.
    let parentKey = def.parentKeyOf(item);
    while (parentKey !== null && !shown.has(parentKey)) {
      const parent = byKey.get(parentKey);
      if (parent === undefined) break;
      shown.set(parentKey, { item: parent, matching: false });
      parentKey = def.parentKeyOf(parent);
    }
  }

  const items = [...shown.values()]
    .toSorted((a, b) => def.compareItems(a.item, b.item))
    .map(({ item, matching: isMatch }) => ({ ...item, matching: isMatch }));

  return {
    card: card.summary(),
    via: card.via,
    reduction: def.reduce(card.inScope),
    sections: buildSections(def, card.inScope),
    items,
  };
}

/** One entry per distinct section path on the card, in the order the sections first appear. */
function buildSections<Item extends CollectionItem, Derived extends CollectionItem, Params, Reduction>(
  def: CollectionDef<Item, Derived, Params, Reduction>,
  inScope: Derived[],
): Array<{ path: string[]; reduction: Reduction }> {
  const sections = new Map<string, { path: string[]; items: Derived[] }>();
  for (const item of inScope) {
    const sectionPath = def.sectionOf(item);
    const key = sectionPath.join("\u0000");
    const entry = sections.get(key) ?? { path: sectionPath, items: [] };
    entry.items.push(item);
    sections.set(key, entry);
  }
  return [...sections.values()].map((entry) => ({ path: entry.path, reduction: def.reduce(entry.items) }));
}
