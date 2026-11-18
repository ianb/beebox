/**
 * The chips a card's header shows for its `sources:` entries
 * (`SourcesEntrySchema`, `src/cards/sources-entry.ts`), one per entry, in
 * order (plan:card-source-chips). Labels follow the in-body `{% source %}`
 * citation chip (`components/Markdown/Source.tsx`): `refLabel`, or
 * "chat, Oct 22" for a chat card.
 */

import { isRecord } from "@shared/is-record";
import { isUrlRef, parseRef } from "@shared/ref-path/core";
import { chatRefLabel, refLabel } from "./ref-label";
import { resolveContentTarget, type ViewTarget } from "./view-url";

/**
 * `file` and `card` are in-box refs, told apart by the `.card` suffix (a
 * display convention, not a lookup); `web` is an http(s) URL; `text` has
 * nothing to open: a label-only entry, a ref that escapes the box, or an
 * `href` that is not an http(s) URL.
 */
export type SourceChipKind = "file" | "card" | "web" | "text";

export interface SourceChip {
  kind: SourceChipKind;
  text: string;
  /** The tooltip: the entry's note, else what it points at. */
  title: string;
  /** Where a `file` or `card` chip navigates. */
  target: ViewTarget | null;
  /** Where a `web` chip links. */
  href: string | null;
  pos: string | null;
  note: string | null;
}

/** Types whose own view draws their sources at its top: the header would repeat them. */
const OWN_SOURCES_TYPES: ReadonlySet<string> = new Set(["webpage", "recipe"]);

export function cardShowsSourcesSection(type: string | undefined): boolean {
  return type === undefined || !OWN_SOURCES_TYPES.has(type);
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The host of an http(s) URL; null for anything else, including what `URL` cannot parse. */
function httpHost(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch (_e) {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.hostname === "" ? null : url.hostname;
}

/** What every chip of one entry shares, whatever it points at. */
interface EntryBase { label: string | null; pos: string | null; note: string | null }

function webChip(href: string, { label, ...base }: EntryBase): SourceChip {
  const host = httpHost(href);
  return host === null
    ? { kind: "text", text: label ?? href, title: base.note ?? href, target: null, href: null, ...base }
    : { kind: "web", text: label ?? host, title: base.note ?? href, target: null, href, ...base };
}

function refChip({ ref, basePath }: { ref: string; basePath: string }, { label, ...base }: EntryBase): SourceChip {
  const path = parseRef(ref).path;
  const text = label ?? chatRefLabel(ref)?.label ?? refLabel(path);
  const target = resolveContentTarget(basePath, ref);
  if (target === null) return { kind: "text", text, title: `${base.note ?? ref} (outside the box)`, target: null, href: null, ...base };
  return { kind: path.endsWith(".card") ? "card" : "file", text, title: base.note ?? ref, target, href: null, ...base };
}

/** One chip per usable entry of a `sources:` value; an entry with nothing to show is skipped. */
export function sourceChips(sources: unknown, basePath: string): SourceChip[] {
  if (!Array.isArray(sources)) return [];
  return sources.flatMap((entry: unknown): SourceChip[] => {
    if (!isRecord(entry)) return [];
    const base: EntryBase = { label: nonEmpty(entry["label"]), pos: nonEmpty(entry["pos"]), note: nonEmpty(entry["note"]) };
    const ref = nonEmpty(entry["ref"]);
    const href = nonEmpty(entry["href"]);
    if (ref !== null) return [isUrlRef(ref) ? webChip(ref, base) : refChip({ ref, basePath }, base)];
    if (href !== null) return [webChip(href, base)];
    const { label, pos, note } = base;
    if (label !== null) return [{ kind: "text", text: label, title: note ?? label, target: null, href: null, pos, note }];
    return [];
  });
}

/** Chip text longer than this may truncate on the collapsed line. */
const LONG_CHIP_TEXT = 24;

/**
 * Whether the line needs a toggle to the full list: more than one chip (a
 * narrow card may not fit them all on its one line), a note or pos, or a
 * name long enough to truncate.
 */
export function sourcesHaveDetails(chips: readonly SourceChip[]): boolean {
  return chips.length > 1
    || chips.some((chip) => chip.note !== null || chip.pos !== null || chip.text.length > LONG_CHIP_TEXT);
}
