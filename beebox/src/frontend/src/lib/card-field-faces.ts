/**
 * Which face of a card shows each frontmatter key: the front (the reading
 * face) or Properties (the card as an object in the box).
 *
 * Every common field (`GLOBAL_CARD_FIELDS`, `cards/schema.ts`) has one named
 * place. Every other key is a type field: it belongs in Properties when the
 * type has a body field, since the body is then what the card says; it stays
 * on the front for a bodiless type, or when the schema is unknown (a card that
 * failed validation), so no field is hidden without a place to see it. A
 * bodied type whose body is empty (`isCardBodyEmpty`) also keeps them on the
 * front, so its facts are not hidden behind an empty page
 * (docs/plans/place-shows-cards.md, Track B).
 *
 * An embedded card has no Properties face (`FileView/view.tsx` returns the
 * bare renderer in embed mode), so there its type fields and title stay on the
 * front.
 */

import { blankLeadingTitleHeading } from "@shared/leading-title-heading";
import type { RendererProps } from "../file-type-registry";

/** Mirrors the keys of `GLOBAL_CARD_FIELDS`; a doctest holds the two sets equal. */
export const COMMON_FIELDS = ["title", "contains", "contains-evidence", "todos", "symbol", "prominence", "theme"] as const;
type CommonField = (typeof COMMON_FIELDS)[number];

type Face = "front" | "foundBy" | "properties" | "neither";

const COMMON_FIELD_SET: ReadonlySet<string> = new Set(COMMON_FIELDS);

function isCommonField(key: string): key is CommonField {
  return COMMON_FIELD_SET.has(key);
}

function commonFieldFace(key: CommonField, embed: boolean): Face {
  switch (key) {
    // The title is the card's header; an embed has no header, so it shows here.
    case "title": return embed ? "front" : "neither";
    case "todos": return "front";
    // Shown as the Appearance row.
    case "theme": return "neither";
    // Properties' named "Found by" rows.
    case "contains":
    case "contains-evidence":
    case "symbol":
    case "prominence": return "foundBy";
  }
}

/**
 * The field that titles a card's front: `title:`, else a named entity's
 * `name:` (person, record), as the card header falls back. Undefined when
 * neither is a string.
 */
export function bodyHeadingField(frontmatter: Record<string, unknown> | undefined): "title" | "name" | undefined {
  if (typeof frontmatter?.["title"] === "string") return "title";
  if (typeof frontmatter?.["name"] === "string") return "name";
  return undefined;
}

/** The title a front's body may repeat as its opening heading: the `bodyHeadingField`'s value. */
export function bodyHeadingTitle(frontmatter: Record<string, unknown> | undefined): string | undefined {
  const field = bodyHeadingField(frontmatter);
  const value = field === undefined ? undefined : frontmatter?.[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * The body a front shows, or null when it would show no text: no body, only
 * whitespace, or only a heading that repeats the title. A leading
 * `# <title>` line is blanked, not removed, so todo locators (counted from
 * `bodyLineOffset`) keep their numbers.
 */
export function shownCardBody(body: string | undefined, title: string | undefined): string | null {
  if (body === undefined) return null;
  const shown = title === undefined ? body : blankLeadingTitleHeading(body, title);
  return shown.trim() === "" ? null : shown;
}

/**
 * True when the front shows no body text (`shownCardBody` is null). `CardBody`
 * and every `splitCardFields` caller use it, so the front and Properties agree.
 */
export function isCardBodyEmpty(body: string | undefined, title: string | undefined): boolean {
  return shownCardBody(body, title) === null;
}

/**
 * `front` is what the reading face shows; `foundBy` holds the common fields
 * Properties shows as named rows; `properties` holds the type fields
 * Properties shows in the fields table. `title` and `theme` (outside embed
 * mode) are in none: the header and the Appearance row show them. Type fields
 * go to the front in an embed, for a type without a body field, and when
 * `bodyEmpty`; otherwise to Properties.
 */
export function splitCardFields(
  frontmatter: Record<string, unknown>,
  { hasBodyField, bodyEmpty, mode }: { hasBodyField: boolean | null; bodyEmpty: boolean; mode: RendererProps["mode"] },
): { front: Record<string, unknown>; foundBy: Record<string, unknown>; properties: Record<string, unknown> } {
  const embed = mode === "embed";
  const typeFieldFace: Face = embed || hasBodyField !== true || bodyEmpty ? "front" : "properties";
  const front: Record<string, unknown> = {};
  const foundBy: Record<string, unknown> = {};
  const properties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    const face = isCommonField(key) ? commonFieldFace(key, embed) : typeFieldFace;
    if (face === "front") front[key] = value;
    else if (face === "foundBy") foundBy[key] = value;
    else if (face === "properties") properties[key] = value;
  }
  return { front, foundBy, properties };
}
