/**
 * How a card's document hands its headings to the card's contents menu. The
 * card surface owns the outline (`useCardOutline`) and provides the setter;
 * the `Markdown` that is the card's document (`outline` prop) publishes the
 * headings of the tree it renders. `Markdown` provides `null` below itself,
 * so a card embedded in the body cannot publish into the outer card.
 */

import { createContext, useCallback, useState } from "react";
import { sameEntries, type OutlineEntry } from "./outline";

export type PublishOutline = (entries: readonly OutlineEntry[] | null) => void;

export const CardOutlineContext = createContext<PublishOutline | null>(null);

/**
 * The outline a card surface holds. Publishing the same headings keeps the
 * previous array, so a text-only edit leaves the menu's outline unchanged.
 */
export function useCardOutline(): [readonly OutlineEntry[] | null, PublishOutline] {
  const [entries, setEntries] = useState<readonly OutlineEntry[] | null>(null);
  const publish = useCallback<PublishOutline>((next) => {
    setEntries((previous) => (previous !== null && next !== null && sameEntries(previous, next) ? previous : next));
  }, []);
  return [entries, publish];
}
