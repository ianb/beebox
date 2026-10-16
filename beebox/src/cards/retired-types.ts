/**
 * Card types the engine no longer has, each with what to use instead. Box
 * guidance written before a type was retired can still tell an agent to
 * create one; the error then says where the content goes now.
 */

const RETIRED_CARD_TYPES: Readonly<Record<string, string>> = {
  memo: "the memo type was retired; a captured note is a doc card (`Name.doc.card`)",
};

/** ` (<what to use instead>)` for a retired type, or "" for any other. */
export function retiredTypeHint(type: string): string {
  const hint = RETIRED_CARD_TYPES[type];
  return hint === undefined ? "" : ` (${hint})`;
}
