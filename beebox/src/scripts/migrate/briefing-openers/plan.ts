/**
 * `briefing-openers-2026-10`: move `openers:` from briefing cards to the
 * place's landmark (`navigation.openers`). The whole decision, as a pure
 * function of the files' text, so a doctest reaches every case with no box on
 * disk; `run.ts` is the IO around it (docs/plans/landmark-arrival.md, Track B).
 *
 * Per briefing, in order:
 *
 * 1. An untouched stock seed at `_content/briefing.briefing.card` (its sha256 is
 *    a `briefing-seed` hash) becomes the current seed, and the root landmark
 *    gets `STOCK_ROOT_OPENERS` unless it already has an `openers` key. This also
 *    covers template sync having replaced the old seed before the migration ran.
 * 2. No `openers` key: nothing to do.
 * 3. A landmark in the same directory without `navigation.openers`: the list
 *    moves there and leaves the briefing.
 * 4. A landmark that already has `navigation.openers` (`[]` included) is
 *    authoritative and never appended to. An equal list (after trimming) is
 *    dropped from the briefing; a different one is a `conflict`.
 * 5. A root briefing with no root landmark: one is created with what
 *    `installRootLandmark` writes, plus the briefing's openers.
 * 6. Any other briefing with openers and no landmark: `no-place`.
 *
 * An empty or null `openers:` has nothing to move, so it is removed even where
 * there is no landmark. A value that is not a list of strings, or YAML that does
 * not parse where an edit is needed, is `malformed`. So is a landmark the plan
 * writes that the landmark loader would reject (an opener that is blank,
 * multi-line, or too long): moving the list there would make the place
 * unreadable. Every failure stops the run before anything is written.
 *
 * YAML edits go through `parseDocument` so untouched keys keep their
 * formatting (the `landmark-symbol` precedent).
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import { isMap, parseDocument } from "yaml";
import { z } from "zod";
import { splitCardContent } from "../../../cards/frontmatter.js";
import { isRecord } from "../../../shared/is-record.js";
import { TEMPLATE_STOCK_HASHES } from "../../../core/template-stock-hashes.js";
import { createBriefingTemplate } from "../../../schemas/briefing.js";
import { createLandmarkTemplate, OpenerEntry, parseLandmarkFields, STOCK_ROOT_OPENERS } from "../../../schemas/landmark.js";

export const ROOT_BRIEFING_PATH = "_content/briefing.briefing.card";
const ROOT_DIR = "_content";
const NEW_ROOT_LANDMARK_PATH = "_content/Box.landmark.card";

export interface BriefingInput {
  /** Box-relative path of the briefing card. */
  path: string;
  text: string;
  /** The first sorted `*.landmark.card` in the briefing's directory, or null. */
  landmark: { path: string; text: string } | null;
}

export interface OpenerPlanInputs {
  briefings: BriefingInput[];
  /** Label for a root landmark the plan creates (`installRootLandmark` uses the box slug). */
  rootLabel: string;
}

export type FailureKind = "conflict" | "no-place" | "malformed";
export interface OpenerFailure { kind: FailureKind; path: string; message: string }
/** One file to write; `before` is null for a file the plan creates. */
export interface FileWrite { path: string; before: string | null; after: string }
export type BriefingOutcome = "stock" | "converted" | "already";
export interface OpenerPlan {
  writes: FileWrite[];
  outcomes: Array<{ path: string; outcome: BriefingOutcome }>;
  failures: OpenerFailure[];
}

type OpenersRead =
  | { kind: "none" }
  | { kind: "list"; list: string[] }
  | { kind: "malformed"; reason: string };

/** The frontmatter's YAML document, or null when the card has no frontmatter block. */
function frontmatterDoc(text: string): { doc: ReturnType<typeof parseDocument>; body: string } | null {
  const split = splitCardContent(text);
  if (!split.hasFrontmatter) return null;
  return { doc: parseDocument(split.frontmatterText), body: split.body };
}

function readList(value: unknown, where: string): OpenersRead {
  if (value === undefined) return { kind: "none" };
  if (value === null) return { kind: "list", list: [] };
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return { kind: "list", list: value };
  return { kind: "malformed", reason: `${where} is not a list of strings` };
}

/** `openers` at the top of a card's frontmatter (`navigation.openers` when `nested`). */
export function readOpeners(text: string, { nested }: { nested: boolean }): OpenersRead {
  const fm = frontmatterDoc(text);
  if (fm === null) return { kind: "none" };
  if (fm.doc.errors.length > 0) {
    // Unreadable YAML: say "malformed" only when it visibly carries the key.
    const pattern = nested ? /^\s+openers\s*:/m : /^openers\s*:/m;
    return pattern.test(text) ? { kind: "malformed", reason: "frontmatter does not parse as YAML" } : { kind: "none" };
  }
  const data: unknown = fm.doc.toJS();
  if (!isRecord(data)) return { kind: "none" };
  if (!nested) return readList(data["openers"], "openers");
  const navigation = data["navigation"];
  if (!isRecord(navigation)) return { kind: "none" };
  return readList(navigation["openers"], "navigation.openers");
}

function render(doc: ReturnType<typeof parseDocument>, body: string): string {
  // `lineWidth: 0` keeps yaml from reflowing long scalars elsewhere in the
  // block; no flow padding keeps `[triage]` from becoming `[ triage ]`.
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()}\n---\n${body}`;
}

/** The card with `navigation.openers` set to `list`, or null when its frontmatter cannot be edited. */
function withLandmarkOpeners(text: string, list: readonly string[]): string | null {
  const fm = frontmatterDoc(text);
  if (fm === null || fm.doc.errors.length > 0) return null;
  const navigation = fm.doc.get("navigation");
  if (navigation === undefined || navigation === null) fm.doc.set("navigation", fm.doc.createNode({ openers: [...list] }));
  else if (isMap(navigation)) navigation.set("openers", fm.doc.createNode([...list]));
  else return null;
  return render(fm.doc, fm.body);
}

function withoutBriefingOpeners(text: string): string {
  const fm = frontmatterDoc(text);
  if (fm === null) return text;
  fm.doc.delete("openers");
  return render(fm.doc, fm.body);
}

const STOCK_HASHES = new Set([TEMPLATE_STOCK_HASHES["briefing-seed"].current, ...TEMPLATE_STOCK_HASHES["briefing-seed"].superseded]);
const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const trimmed = (list: readonly string[]): string[] => list.map((entry) => entry.trim());
const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && trimmed(a).every((entry, i) => entry === trimmed(b)[i]);

/** Plan every move for one box. Pure: the same inputs give the same plan. */
export function planOpenerMoves(inputs: OpenerPlanInputs): OpenerPlan {
  const original = new Map<string, string | null>();
  const current = new Map<string, string>();
  const created = new Map<string, string>(); // directory → landmark path the plan created
  const failures: OpenerFailure[] = [];
  const outcomes: OpenerPlan["outcomes"] = [];

  function write(file: string, { before, after }: { before: string | null; after: string }): void {
    if (!original.has(file)) original.set(file, before);
    current.set(file, after);
  }
  function landmarkFor(briefing: BriefingInput): { path: string; text: string } | null {
    if (briefing.landmark !== null) return { path: briefing.landmark.path, text: current.get(briefing.landmark.path) ?? briefing.landmark.text };
    const madePath = created.get(path.posix.dirname(briefing.path));
    return madePath === undefined ? null : { path: madePath, text: current.get(madePath) ?? "" };
  }
  function setOpeners(landmark: { path: string; text: string }, list: readonly string[]): boolean {
    const after = withLandmarkOpeners(landmark.text, list);
    if (after === null) {
      failures.push({ kind: "malformed", path: landmark.path, message: `${landmark.path}: frontmatter cannot be edited; add navigation.openers by hand` });
      return false;
    }
    write(landmark.path, { before: landmark.text, after });
    return true;
  }
  function createRoot(list: readonly string[]): void {
    write(NEW_ROOT_LANDMARK_PATH, { before: null, after: createLandmarkTemplate({ label: inputs.rootLabel, symbol: "📦", openers: list }) });
    created.set(ROOT_DIR, NEW_ROOT_LANDMARK_PATH);
  }

  for (const briefing of inputs.briefings) {
    const landmark = landmarkFor(briefing);
    // Case 1: an untouched stock seed.
    if (briefing.path === ROOT_BRIEFING_PATH && STOCK_HASHES.has(sha256(briefing.text))) {
      const seed = createBriefingTemplate();
      if (briefing.text !== seed) write(briefing.path, { before: briefing.text, after: seed });
      if (landmark === null) createRoot(STOCK_ROOT_OPENERS);
      else {
        const has = readOpeners(landmark.text, { nested: true });
        if (has.kind === "malformed") failures.push({ kind: "malformed", path: landmark.path, message: `${landmark.path}: ${has.reason}; resolve by hand` });
        else if (has.kind === "none") setOpeners(landmark, STOCK_ROOT_OPENERS);
      }
      outcomes.push({ path: briefing.path, outcome: "stock" });
      continue;
    }
    const found = readOpeners(briefing.text, { nested: false });
    if (found.kind === "malformed") {
      failures.push({ kind: "malformed", path: briefing.path, message: `${briefing.path}: ${found.reason}; resolve by hand` });
      continue;
    }
    // Case 2: nothing listed.
    if (found.kind === "none") { outcomes.push({ path: briefing.path, outcome: "already" }); continue; }
    const strip = (): void => {
      write(briefing.path, { before: briefing.text, after: withoutBriefingOpeners(briefing.text) });
      outcomes.push({ path: briefing.path, outcome: "converted" });
    };
    if (found.list.length === 0) { strip(); continue; }
    if (landmark === null) {
      // Case 5: the root place gets its landmark; case 6: anywhere else fails.
      if (path.posix.dirname(briefing.path) === ROOT_DIR) { createRoot(found.list); strip(); continue; }
      failures.push({ kind: "no-place", path: briefing.path, message: `${briefing.path}: openers have no landmark in this directory; add a landmark here or move them by hand` });
      continue;
    }
    const existing = readOpeners(landmark.text, { nested: true });
    if (existing.kind === "malformed") {
      failures.push({ kind: "malformed", path: landmark.path, message: `${landmark.path}: ${existing.reason}; resolve by hand` });
      continue;
    }
    // Case 3: the list moves to the landmark.
    if (existing.kind === "none") { if (setOpeners(landmark, found.list)) strip(); continue; }
    // Case 4: the landmark's list is authoritative.
    if (sameList(existing.list, found.list)) { strip(); continue; }
    failures.push({ kind: "conflict", path: briefing.path, message: `${briefing.path}: openers differ from ${landmark.path} navigation.openers; resolve by hand` });
  }

  const writes = [...current].flatMap(([file, after]) => {
    const before = original.get(file) ?? null;
    return before === after ? [] : [{ path: file, before, after }];
  });
  for (const file of writes) {
    if (!file.path.endsWith(".landmark.card")) continue;
    const reason = landmarkRejection(file.after);
    if (reason !== null) failures.push({ kind: "malformed", path: file.path, message: `${file.path}: ${reason}; resolve by hand` });
  }
  return { writes, outcomes, failures };
}

/** Why the landmark loader (`parseLandmarkFields`) would reject `text`, or null when it accepts it. */
function landmarkRejection(text: string): string | null {
  if (parseLandmarkFields(text) !== null) return null;
  const openers = readOpeners(text, { nested: true });
  if (openers.kind !== "list") return "the landmark would not parse";
  const checked = z.array(OpenerEntry).safeParse(openers.list);
  const issue = checked.success ? undefined : checked.error.issues[0];
  return issue === undefined ? "the landmark would not parse" : `navigation.openers[${String(issue.path[0])}]: ${issue.message}`;
}
