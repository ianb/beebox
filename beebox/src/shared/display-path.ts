/**
 * The boxholder-facing display form of a box path — the vocabulary the human
 * reads/speaks, as opposed to the canonical `/_content/...` form refs, URLs,
 * and storage use (`box-path.ts`, `ref-path.ts`).
 *
 * BOXHOLDER-SETTLED vocabulary (`docs/plans/one-root-box-layout.md`):
 *
 *  - A `_content` path displays BARE, no leading slash: `recipes/Soup.recipe.card`
 *    (canonical `/_content/recipes/Soup.recipe.card`).
 *  - Any other area displays as `<AreaLabel>:path/inside`: `Config:box.json`,
 *    `Bookkeeping:jobs/x.job.card`, `Publish:site/index.html`, `Tmp:scratch.txt`.
 *    The label is DERIVED from the area name (strip the underscore, capitalize
 *    the first letter) — never hand-kept.
 *  - Spoken/prose form uses the same label: "in Config", "in Bookkeeping".
 *  - The box root itself displays as `/` (browse root view only).
 *
 * Display-only: refs, URLs, and API inputs stay canonical everywhere else —
 * convert at the last moment before rendering to the boxholder, and convert
 * back immediately after reading typed/pasted boxholder input.
 *
 * Pure string operations, no Node deps — mirrors `box-path.ts`'s placement so
 * both backend (`../shared/display-path.js`) and frontend (`@shared/display-path`)
 * share one implementation.
 */

import { BOX_ROOT_VOCABULARY } from "../lib/box-root-vocabulary.js";

const AREA_NAMES: readonly string[] = BOX_ROOT_VOCABULARY.filter((entry) => entry.kind === "area").map(
  (entry): string => entry.name
);
const AREA_NAME_SET: ReadonlySet<string> = new Set(AREA_NAMES);

/**
 * Derive an area's display label from its underscore name: `_config` →
 * `Config`, `_bookkeeping` → `Bookkeeping`. No hand-kept mapping — the label
 * is always the area name with its leading underscore stripped and its first
 * letter capitalized.
 */
export function areaDisplayLabel(areaName: string): string {
  const bare = areaName.replace(/^_+/, "");
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

const LABEL_TO_AREA: ReadonlyMap<string, string> = new Map(
  AREA_NAMES.map((name): [string, string] => [areaDisplayLabel(name).toLowerCase(), name])
);

/**
 * `LABEL_TO_AREA` minus `_content`: `content:` is a real, registered URI
 * scheme (IANA-provisional; Android `content://` URIs) and displays bare
 * anyway (`toDisplayPath` never emits `Content:...`), so it must never be
 * detected as a display-form leak — see {@link detectDisplayFormPath}.
 */
const DETECTABLE_LABEL_TO_AREA: ReadonlyMap<string, string> = new Map(
  Array.from(LABEL_TO_AREA).filter(([, area]) => area !== "_content")
);

/**
 * Canonical box path → boxholder display form. Accepts either the canonical
 * leading-`/` ref form or an already box-root-relative path.
 *
 * `/_content/recipes/Soup.recipe.card` → `recipes/Soup.recipe.card`
 * `/_config/box.json` → `Config:box.json`
 * `/_bookkeeping/jobs/x.job.card` → `Bookkeeping:jobs/x.job.card`
 * `/_publish/site/index.html` → `Publish:site/index.html`
 * `/_tmp/scratch.txt` → `Tmp:scratch.txt`
 * `/_content` → `` (empty string — the content root)
 * `/` or `` → `/`
 *
 * An unknown top-level segment (shouldn't exist in a valid box) passes
 * through unchanged.
 */
export function toDisplayPath(boxPath: string): string {
  const stripped = boxPath.replace(/^\/+/, "");
  if (stripped === "") return "/";
  const slash = stripped.indexOf("/");
  const first = slash === -1 ? stripped : stripped.slice(0, slash);
  const rest = slash === -1 ? "" : stripped.slice(slash + 1);
  if (first === "_content") return rest;
  if (AREA_NAME_SET.has(first)) return `${areaDisplayLabel(first)}:${rest}`;
  return boxPath;
}

/**
 * Boxholder display form → canonical box path (leading `/`, `/_content/...`
 * form). Inverse of {@link toDisplayPath}, tolerant of several input shapes:
 *
 * `x/y` and `/x/y` → `/_content/x/y`
 * `Config:x` (area label case-insensitive) → `/_config/x`
 * `/_config/x` and `_config/x` (raw canonical, already area-coded) → `/_config/x`
 * `` and `/` → `/`
 */
export function fromDisplayPath(display: string): string {
  const stripped = display.replace(/^\/+/, "");
  if (stripped === "") return "/";

  // Raw canonical form: the first segment already names a known area.
  const slash = stripped.indexOf("/");
  const first = slash === -1 ? stripped : stripped.slice(0, slash);
  if (AREA_NAME_SET.has(first)) return `/${stripped}`;

  // Area-label form: "Config:x".
  const colon = display.indexOf(":");
  if (colon !== -1) {
    const label = display.slice(0, colon).toLowerCase();
    const area = LABEL_TO_AREA.get(label);
    if (area !== undefined) {
      const rest = display.slice(colon + 1);
      return rest === "" ? `/${area}` : `/${area}/${rest}`;
    }
  }

  // Bare content-relative form.
  return `/_content/${stripped}`;
}

/** A raw string recognized as a boxholder DISPLAY-FORM path, and what it means. */
export interface DisplayFormPathMatch {
  /** The canonical box path this display form names. */
  canonical: string;
  /** The area's display label as matched (canonical casing, e.g. "Config"). */
  areaLabel: string;
}

/**
 * Detect a boxholder DISPLAY-FORM path (`Config:box.json`,
 * `bookkeeping:jobs/x.job.card`) leaked into a slot that expects a canonical
 * box path — a ref, an HTTP/tRPC path input, a CLI path argument.
 *
 * Matches a case-insensitive area display label immediately followed by `:`
 * — `content:` is deliberately EXCLUDED (a real, registered URI scheme;
 * `_content` also displays bare, never with a label, so `content:` is never
 * a display form beebox itself would produce). A `<label>://` double-slash
 * form is a URL, never a display form, and is never matched (checked before
 * the label lookup so `Config://x` — which is not a form this codebase ever
 * emits — is left alone rather than misreported).
 *
 * Returns `null` for anything else, including a bare relative path (e.g.
 * `recipes/Soup.recipe.card` is indistinguishable from a legitimate
 * relative ref — see the "did you mean" suggestion at diagnostic boundaries
 * instead, not this detector).
 */
export function detectDisplayFormPath(raw: string): DisplayFormPathMatch | null {
  const colon = raw.indexOf(":");
  if (colon === -1) return null;
  if (raw.slice(colon + 1, colon + 3) === "//") return null;
  const label = raw.slice(0, colon).toLowerCase();
  const area = DETECTABLE_LABEL_TO_AREA.get(label);
  if (area === undefined) return null;
  const rest = raw.slice(colon + 1);
  const canonical = rest === "" ? `/${area}` : `/${area}/${rest}`;
  return { canonical, areaLabel: areaDisplayLabel(area) };
}

/**
 * The canonical caller-visible message for a detected display-form path leak
 * — one sentence, shared by every choke point (ref lint, HTTP/tRPC path
 * inputs, CLI path arguments) so the wording never drifts between them:
 * "`Config:box.json` is the boxholder's display form; write `/_config/box.json`".
 */
export function displayFormPathMessage(raw: string, match: DisplayFormPathMatch): string {
  return `\`${raw}\` is the boxholder's display form; write \`${match.canonical}\``;
}
