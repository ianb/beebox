/**
 * Named builtin views — self-sufficient interface surfaces a `view` card
 * can point at (docs/plans/interface-as-cards.md, "instrument cards").
 * The card supplies the address and notes; the view brings its own data.
 *
 * Single source for schema validation (src/schemas/view.ts) and the
 * frontend component registry (src/frontend/src/renderers/view.tsx) —
 * keep the registry in sync when adding a name here.
 */
export interface NamedView {
  name: string;
  description: string;
}

export const NAMED_VIEWS: readonly NamedView[] = [
  {
    name: "landmarks",
    description: "Every landmark in the box, each with its resolved links",
  },
  {
    name: "chat-picker",
    description: "Fresh chats grouped by landmark, with a New-chat button per landmark",
  },
];

export const NAMED_VIEW_NAMES: readonly string[] = NAMED_VIEWS.map((v) => v.name);
