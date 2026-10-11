/**
 * How the generic field renderer reads a card's fields
 * (docs/plans/readable-card-fields.md): a key becomes a label, and a small
 * object of a known shape becomes one value. Display only; the Source view
 * keeps the keys and shapes as written.
 */

/** A small object read as one value: its text, a link when it names a card, and a muted aside. */
export interface CompactValue {
  text: string;
  ref?: string;
  aside?: string;
}

/** `back-by` → "Back by": split on `-` and `_`, sentence case. */
/**
 * The fields without a `name` row whose value is the card's header title: the
 * header already shows it. Only an equal value drops it, so a card headed by
 * something else (a `title:`, a landmark's label) keeps its `name` row.
 * Callers apply it before deciding whether any rows remain to frame.
 */
export function withoutHeaderName(fields: Record<string, unknown>, headerTitle: string): Record<string, unknown> {
  if (fields["name"] !== headerTitle) return fields;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "name"));
}

export function fieldLabel(key: string): string {
  const words = key.split(/[_-]+/).filter((word) => word !== "").join(" ");
  if (words === "") return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const IDENTITY_TEXT_KEYS = ["name", "label", "title"] as const;
const IDENTITY_ASIDE_KEYS = ["role", "note", "notes"] as const;
const PLAIN_TEXT_KEYS = ["text", "value"] as const;
const PLAIN_ASIDE_KEYS = ["note", "notes"] as const;

/**
 * The one key of `textKeys` the object has, when every other key is in
 * `extraKeys` and all of them hold strings; otherwise `null`.
 */
function shapeText(
  value: Record<string, unknown>,
  { textKeys, extraKeys }: { textKeys: readonly string[]; extraKeys: readonly string[] },
): string | null {
  const present = textKeys.filter((key) => key in value);
  if (present.length !== 1) return null;
  const [textKey] = present;
  if (textKey === undefined) return null;
  for (const [key, item] of Object.entries(value)) {
    if (key !== textKey && !extraKeys.includes(key)) return null;
    if (typeof item !== "string") return null;
  }
  const text = value[textKey];
  return typeof text === "string" ? text : null;
}

function asideOf(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  const parts = keys.map((key) => value[key]).filter((item): item is string => typeof item === "string" && item.trim() !== "");
  return parts.length === 0 ? undefined : parts.join(", ");
}

/**
 * One value for a known small shape, or `null` to show the object as nested
 * rows. An identity shape (`name`, `label`, or `title`, with an optional
 * `ref`, `role`, `note`, `notes`) links its name. A plain value shape (`text`
 * or `value`, with an optional `note`/`notes`) has no `ref`: beside `text`, a
 * `ref` can be evidence (a guide observation), so that shape keeps its rows.
 * Any other key also keeps the rows, so nothing is hidden.
 */
export function compactValue(value: Record<string, unknown>): CompactValue | null {
  const name = shapeText(value, { textKeys: IDENTITY_TEXT_KEYS, extraKeys: ["ref", ...IDENTITY_ASIDE_KEYS] });
  if (name !== null) {
    const aside = asideOf(value, IDENTITY_ASIDE_KEYS);
    const ref = typeof value.ref === "string" ? value.ref : undefined;
    return { text: name, ...(ref === undefined ? {} : { ref }), ...(aside === undefined ? {} : { aside }) };
  }
  const text = shapeText(value, { textKeys: PLAIN_TEXT_KEYS, extraKeys: PLAIN_ASIDE_KEYS });
  if (text !== null) {
    const aside = asideOf(value, PLAIN_ASIDE_KEYS);
    return aside === undefined ? { text } : { text, aside };
  }
  return null;
}
