/**
 * Budget lint for `prominence` (`src/shared/prominence.ts`) — box-level rules
 * that catch the case where many individually-reasonable local decisions add
 * up wrong (`docs/implemented-plans/card-prominence.md`, "Budget lint"). Its own module,
 * on the pattern `lint-symbol.ts` sets, but box-level rather than one-card:
 * these rules need to see a directory's other cards, so it scans the box
 * itself instead of being dispatched per-card from `card-lint.ts`.
 *
 * Every rule here is a warning: a directory with eight primary cards is
 * untidy, not broken (principle #6, `docs/engineering-principles.md`).
 * The redundant `links:` info rule (a landmark link whose target already
 * says `primary`/`entry-point`) is Track B's — it needs the derived-list
 * machinery this module doesn't have.
 */

import * as path from "node:path";
import { listBoxCardFiles } from "./list-cards.js";
import { loadCardFrontmatter } from "./frontmatter-field.js";
import { typeFromFilename, type LoadCardContext } from "./card-io.js";
import { effectiveLevel, type ProminenceLevel } from "../shared/prominence.js";
import { attachDirOwnerBasename, cardBasename, isAttachDirName, isInsideAttachScope } from "../shared/attach-path.js";
import { LANDMARK_CONTENT_DIR } from "./landmark/root-dir.js";
import { redundantLinkWarnings } from "./lint-prominence-redundant.js";

/** More than this many entry points in one directory is a warning. */
export const MAX_ENTRY_POINTS_PER_DIR = 2;
/** More than this many primary cards in one directory is a warning. */
export const MAX_PRIMARY_PER_DIR = 7;

export interface ProminenceLintWarning {
  /** Box-root-relative path the warning applies to (a card, or a directory for the two budget rules). */
  path: string;
  rule:
    | "too-many-entry-points"
    | "too-many-primary"
    | "under-background-landmark"
    | "inside-attach-scope"
    | "landmark-prominence"
    | "background-root-landmark"
    | "redundant-link";
  message: string;
  /**
   * `"warning"` (the default budget/cascade rules) or `"info"` (the
   * redundant-link rule alone) — a directory over budget is untidy, a
   * redundant link is a cleanup opportunity, never urgent either way. Never
   * counted toward `bbx validate`'s exit code regardless of severity.
   */
  severity: "warning" | "info";
}

interface CardRecord {
  relPath: string;
  dir: string;
  isLandmark: boolean;
  /** The raw frontmatter value, unvalidated — used where the WRITTEN value matters (landmark rules), not the resolved effective level. */
  declared: string | undefined;
  effective: ProminenceLevel | "ordinary";
}

interface ScanState {
  boxRoot: string;
  records: CardRecord[];
  /** Lowercased card basenames present in each directory — used to decide whether an attach scope is owned. */
  basenamesByDir: Map<string, Set<string>>;
  warnings: ProminenceLintWarning[];
}

/**
 * Scan a box for `prominence` budget violations. Returns the list of
 * warnings; empty array means a clean tree.
 */
export async function lintProminenceBudget(
  boxRoot: string,
  ctx: LoadCardContext
): Promise<ProminenceLintWarning[]> {
  const state: ScanState = {
    boxRoot,
    records: [],
    basenamesByDir: new Map(),
    warnings: [],
  };
  await readCardRecords(state, ctx);

  const byDir = new Map<string, CardRecord[]>();
  const backgroundLandmarksByDir = new Map<string, CardRecord>();
  for (const card of state.records) {
    const existing = byDir.get(card.dir);
    if (existing) {
      existing.push(card);
    } else {
      byDir.set(card.dir, [card]);
    }
    if (card.isLandmark && card.declared === "background") backgroundLandmarksByDir.set(card.dir, card);
  }

  for (const [dir, dirCards] of byDir) budgetWarnings({ dir, dirCards }, state.warnings);

  for (const landmark of backgroundLandmarksByDir.values()) {
    if (landmark.dir !== LANDMARK_CONTENT_DIR) continue;
    state.warnings.push({
      path: landmark.relPath,
      rule: "background-root-landmark",
      severity: "warning",
      message:
        "the root landmark is marked prominence: background — the root is the box's identity, not a place " +
        "that can be housekeeping, so the value is ignored; remove it",
    });
  }

  for (const card of state.records) {
    if (card.isLandmark) {
      landmarkOwnLevelWarning(card, state.warnings);
      continue;
    }
    cascadeWarning(card, { backgroundLandmarksByDir, warnings: state.warnings });
    attachScopeWarning(card, state);
  }

  await redundantLinkWarnings(state.boxRoot, {
    landmarks: state.records.filter((r) => r.isLandmark),
    warnings: state.warnings,
  });

  state.warnings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule));
  return state.warnings;
}

function budgetWarnings(
  { dir, dirCards }: { dir: string; dirCards: CardRecord[] },
  warnings: ProminenceLintWarning[]
): void {
  const dirLabel = dir === "" ? "." : dir;
  const entryPoints = dirCards.filter((c) => c.effective === "entry-point");
  if (entryPoints.length > MAX_ENTRY_POINTS_PER_DIR) {
    warnings.push({
      path: dirLabel,
      rule: "too-many-entry-points",
      severity: "warning",
      message:
        `${String(entryPoints.length)} entry points in one directory; an entry point is where a newcomer ` +
        "starts, and a directory usually has one",
    });
  }
  const primaries = dirCards.filter((c) => c.effective === "primary");
  if (primaries.length > MAX_PRIMARY_PER_DIR) {
    warnings.push({
      path: dirLabel,
      rule: "too-many-primary",
      severity: "warning",
      message:
        `${String(primaries.length)} primary cards in ${dirLabel}; primary is the thing itself, ` +
        "not everything good — if everything here is the thing, mark nothing and give the directory an entry point",
    });
  }
}

/**
 * `primary`/`entry-point` on a card whose OWN directory's landmark, or any
 * ANCESTOR directory's landmark, is written `background` — walking every
 * ancestor directory (not only the nearest landmark-holding one), so a
 * background landmark two levels up still folds a grandchild even through
 * an intervening non-background landmark. Same ancestor-walk shape as
 * `cascade.ts`'s `isListedLandmark`, at the card level instead of the
 * landmark level.
 */
function cascadeWarning(
  card: CardRecord,
  { backgroundLandmarksByDir, warnings }: { backgroundLandmarksByDir: Map<string, CardRecord>; warnings: ProminenceLintWarning[] },
): void {
  if (card.isLandmark) return;
  if (card.effective !== "primary" && card.effective !== "entry-point") return;
  for (let cursor: string | null = card.dir; cursor !== null; cursor = ancestorDir(cursor)) {
    const landmark = backgroundLandmarksByDir.get(cursor);
    if (landmark === undefined) continue;
    warnings.push({
      path: card.relPath,
      rule: "under-background-landmark",
      severity: "warning",
      message:
        `${card.relPath} is marked ${card.effective}, but its landmark ${landmark.relPath} is marked ` +
        "prominence: background — a background place folds away everything under it",
    });
    return;
  }
}

/** Ancestor directory of `dir`, or null once past the box root. Mirrors `prominence-index.ts`'s `parentLandmarkDir`. */
function ancestorDir(dir: string): string | null {
  if (dir === "") return null;
  const parent = path.dirname(dir);
  return parent === "." ? "" : parent;
}

/** `entry-point`/`primary` written directly on a landmark card. */
function landmarkOwnLevelWarning(landmark: CardRecord, warnings: ProminenceLintWarning[]): void {
  if (landmark.declared !== "entry-point" && landmark.declared !== "primary") return;
  warnings.push({
    path: landmark.relPath,
    rule: "landmark-prominence",
    severity: "warning",
    message: "a landmark marks a place; the place's entry point is a visitable card inside it",
  });
}

/** `primary`/`entry-point` on a card living inside an OWNED `.attach/` scope. */
function attachScopeWarning(card: CardRecord, state: ScanState): void {
  if (card.effective !== "primary" && card.effective !== "entry-point") return;
  if (!isInsideAttachScope(card.relPath)) return;
  if (!isOwnedAttachScope(card.relPath, state.basenamesByDir)) return;
  // An attach scope that holds its own landmark is that landmark's home:
  // `prunedSubtree` walks it, so prominence inside it DOES feed the
  // landmark's derived list (test1's Acids_Bases.attach/ is the live case).
  if (attachScopeHasLandmark(card.relPath, state.records)) return;
  state.warnings.push({
    path: card.relPath,
    rule: "inside-attach-scope",
    severity: "warning",
    message: "prominence inside an attach scope has no effect; mark the owner card, or list it in the landmark's `links:`",
  });
}

/**
 * Whether a card's path lies inside a `<basename>.attach/` scope whose owner
 * (a sibling card matching that basename) actually exists — an "owned"
 * attach scope, mirroring `webapp/routes/figure.ts`'s `hasOwningCard` but
 * against the box-wide basename index this scan already built.
 */
/** Whether the attach scope `relPath` sits in holds a landmark card anywhere inside it. */
function attachScopeHasLandmark(relPath: string, records: CardRecord[]): boolean {
  const segments = relPath.split("/");
  const attachIndex = segments.findIndex((segment) => isAttachDirName(segment));
  if (attachIndex === -1) return false;
  const scopeDir = segments.slice(0, attachIndex + 1).join("/");
  return records.some((r) => r.isLandmark && (r.dir === scopeDir || r.dir.startsWith(`${scopeDir}/`)));
}

function isOwnedAttachScope(relPath: string, basenamesByDir: Map<string, Set<string>>): boolean {
  const segments = relPath.split("/");
  const attachIndex = segments.findIndex((segment) => isAttachDirName(segment));
  if (attachIndex === -1) return false;
  const attachSegment = segments[attachIndex];
  if (attachSegment === undefined) return false;
  const owner = attachDirOwnerBasename(attachSegment);
  if (owner === null) return false;
  const parentDir = segments.slice(0, attachIndex).join("/");
  const basenames = basenamesByDir.get(parentDir);
  return basenames !== undefined && basenames.has(owner.toLowerCase());
}

async function readCardRecords(state: ScanState, ctx: LoadCardContext): Promise<void> {
  const absPaths = await listBoxCardFiles(state.boxRoot);
  for (const absPath of absPaths) {
    const relPath = path.relative(state.boxRoot, absPath);
    const dir = dirOf(relPath);
    addBasename(state.basenamesByDir, { dir, basename: cardBasename(relPath) });

    const type = typeFromFilename(relPath);
    if (type === undefined) continue;
    const schema = ctx.cardSchemas.get(type);
    if (schema === undefined) continue;
    const fm = await loadCardFrontmatter(absPath);
    const declaredRaw = fm?.["prominence"];
    const declared = typeof declaredRaw === "string" ? declaredRaw : undefined;
    const declaredLevel = isProminenceLevel(declared) ? declared : undefined;
    state.records.push({
      relPath,
      dir,
      isLandmark: type === "landmark",
      declared,
      effective: effectiveLevel({ declared: declaredLevel, typeDefault: schema.defaultProminence }),
    });
  }
}

function addBasename(basenamesByDir: Map<string, Set<string>>, { dir, basename }: { dir: string; basename: string }): void {
  const existing = basenamesByDir.get(dir);
  if (existing) {
    existing.add(basename.toLowerCase());
  } else {
    basenamesByDir.set(dir, new Set([basename.toLowerCase()]));
  }
}

function isProminenceLevel(value: string | undefined): value is ProminenceLevel {
  return value === "entry-point" || value === "primary" || value === "background";
}

function dirOf(relPath: string): string {
  const dir = path.dirname(relPath);
  return dir === "." ? "" : dir;
}

/** Format prominence-budget warnings for `bbx validate`'s text output. Never counted toward the exit code, `info` included. */
export function formatProminenceLintWarnings(warnings: ProminenceLintWarning[], { colors }: { colors: boolean }): string {
  if (warnings.length === 0) return "";
  const ESC = "";
  const yellow = colors ? (s: string) => `${ESC}[33m${s}${ESC}[0m` : (s: string) => s;
  const cyan = colors ? (s: string) => `${ESC}[36m${s}${ESC}[0m` : (s: string) => s;
  return warnings
    .map((w) => `${w.severity === "info" ? cyan("info") : yellow("warning")}  ${w.path}  [${w.rule}] ${w.message}`)
    .join("\n");
}
