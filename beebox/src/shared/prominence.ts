/**
 * A card's `prominence` — who a card is for, and whether the box should put
 * it in front of a reader who is looking around rather than looking for it.
 * This is not access: every card, at every level, is readable and
 * addressable.
 *
 * Three named levels, absent meaning the card type's default (see
 * `defaultProminence` on `CardSchema`, `src/cards/schema.ts`):
 *
 * - `entry-point` — where a reader starts: an index, an overview, a
 *   dashboard, a collection view.
 * - `primary` — the thing itself, as opposed to material toward it or
 *   about it.
 * - `background` — for the agent, not the reader: logs, state, imports,
 *   scratch, generated intermediates.
 * - absent — **ordinary**, the default for most cards.
 *
 * Lives in `shared/` rather than `cards/` because the frontend reads it too
 * (the same reason `card-symbol.ts` and `todo-model.ts` live here).
 */

import { z } from "zod";

export const Prominence = z.enum(["entry-point", "primary", "background"]);
export type ProminenceLevel = z.infer<typeof Prominence>;

/**
 * A card's level once the type default has been applied: the three declared
 * levels plus `ordinary`, the value absent means for most card types.
 * Ordinary is never written on disk — it's what code sees after resolving
 * absence, never a value `prominence:` itself carries.
 */
export type EffectiveLevel = ProminenceLevel | "ordinary";

/**
 * Resolve a card's effective level from what it declared (its own
 * `prominence` field, if any) and its type's default (`CardSchema.defaultProminence`).
 * A declared value always wins; absence falls back to the type default.
 */
export function effectiveLevel(
  { declared, typeDefault }: { declared: ProminenceLevel | undefined; typeDefault: EffectiveLevel }
): EffectiveLevel {
  return declared ?? typeDefault;
}
