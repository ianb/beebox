/**
 * Three-way merge of composition text, and the minimal edits that turn one
 * text into another (`docs/implemented-plans/composition-editor.md`, Track 5). The
 * editor merges the agent's change on disk (`remote`) into the person's
 * on-screen text (`local`) against the text both started from (`base`).
 *
 * Both work on word-and-space tokens: `text.split(/(\s+)/)` keeps each run
 * of whitespace as its own token, so joining the tokens gives the text back
 * and an agent's paragraph split is a change to one space token. Word
 * hunks that touch each other conflict in diff3, and runs of identical space
 * tokens let the alignment drift, so each word-level conflict is merged once
 * more by character; only a conflict that remains there is reported.
 */
import { diff3Merge, diffIndices } from "node-diff3";

export interface MergeConflict {
  /** The local side's range in `merged`. */
  from: number;
  to: number;
  /** The remote side of the same span, not merged. */
  remote: string;
}

export interface MergeResult {
  merged: string;
  conflicts: MergeConflict[];
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

function tokens(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

/** The character-level merge of one conflicting span, or null when it still conflicts. */
function mergeChars({ a, o, b }: { a: string[]; o: string[]; b: string[] }): string | null {
  let merged = "";
  for (const region of diff3Merge([...a.join("")], [...o.join("")], [...b.join("")])) {
    if (region.ok === undefined) return null;
    merged += region.ok.join("");
  }
  return merged;
}

/** A conflict keeps the local side in `merged` and reports the remote side. */
export function mergeComposition(base: string, { local, remote }: { local: string; remote: string }): MergeResult {
  let merged = "";
  const conflicts: MergeConflict[] = [];
  for (const region of diff3Merge(tokens(local), tokens(base), tokens(remote))) {
    const fine = region.conflict === undefined ? null : mergeChars(region.conflict);
    if (region.ok !== undefined) {
      merged += region.ok.join("");
    } else if (fine !== null) {
      merged += fine;
    } else if (region.conflict !== undefined) {
      const kept = region.conflict.a.join("");
      conflicts.push({ from: merged.length, to: merged.length + kept.length, remote: region.conflict.b.join("") });
      merged += kept;
    }
  }
  return { merged, conflicts };
}

/** The offset where each token starts; one extra entry for the end. */
function offsets(list: readonly string[]): number[] {
  const starts = [0];
  for (const token of list) starts.push((starts[starts.length - 1] ?? 0) + token.length);
  return starts;
}

/** Trim the characters a replaced span shares at its start and end, so a cursor inside a changed word stays put. */
function trimmed(change: TextChange, removed: string): TextChange {
  let head = 0;
  const max = Math.min(removed.length, change.insert.length);
  while (head < max && removed[head] === change.insert[head]) head += 1;
  let tail = 0;
  while (tail < max - head && removed[removed.length - 1 - tail] === change.insert[change.insert.length - 1 - tail]) tail += 1;
  return { from: change.from + head, to: change.to - tail, insert: change.insert.slice(head, change.insert.length - tail) };
}

/**
 * Edits that turn `from` into `to`, as ranges of `from` in ascending order
 * (the form CodeMirror's `changes` takes). Text outside the edits is not
 * touched, so a cursor there does not move.
 */
export function diffToChanges(from: string, to: string): TextChange[] {
  const a = tokens(from);
  const starts = offsets(a);
  return diffIndices(a, tokens(to)).map((hunk) => {
    const [aStart, aLength] = hunk.buffer1;
    const start = starts[aStart] ?? from.length;
    const end = starts[aStart + aLength] ?? from.length;
    return trimmed({ from: start, to: end, insert: hunk.buffer2Content.join("") }, from.slice(start, end));
  });
}
