/**
 * The refusals of a document move (`bin/lib/doc-move.ts`). Each is thrown
 * before anything is written.
 */

import type { DocMoveNotice } from "./doc-move.js";

export class DocMoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocMoveError";
  }
}
export class NotMarkdownError extends DocMoveError {
  constructor(p: string) { super(`${p}: only a .md file can be moved`); this.name = "NotMarkdownError"; }
}
export class MissingSourceError extends DocMoveError {
  constructor(from: string) { super(`${from}: no such file`); this.name = "MissingSourceError"; }
}
export class DestinationExistsError extends DocMoveError {
  constructor(to: string) { super(`${to}: destination already exists`); this.name = "DestinationExistsError"; }
}
export class SamePathError extends DocMoveError {
  constructor(from: string) { super(`${from}: source and destination are the same`); this.name = "SamePathError"; }
}
export class CrossRepositoryError extends DocMoveError {
  constructor(from: string, to: string) { super(`${from} -> ${to}: a move cannot cross between the monorepo and private-issues/ (separate repositories)`); this.name = "CrossRepositoryError"; }
}
export class UntrackedSourceError extends DocMoveError {
  constructor(from: string) { super(`${from}: not tracked by git; git add it first`); this.name = "UntrackedSourceError"; }
}
export function noticeLine(n: DocMoveNotice): string {
  return `${n.path}${n.line === null ? "" : `:L${String(n.line)}`}: ${n.message}`;
}
export class UnsafeReferencesError extends DocMoveError {
  constructor(from: string, notices: readonly DocMoveNotice[]) {
    super(`${from}: references that cannot be rewritten safely; make each path name one file, then rerun:\n${notices.map((n) => `  ${noticeLine(n)}`).join("\n")}`);
    this.name = "UnsafeReferencesError";
  }
}
export class DirtyFilesError extends DocMoveError {
  constructor(from: string, paths: readonly string[]) {
    super(`${from}: these files have uncommitted changes; commit or restore them first: ${paths.join(", ")}`);
    this.name = "DirtyFilesError";
  }
}
export class OutsideRepositoryError extends DocMoveError {
  constructor(p: string) { super(`${p}: path is outside the repository`); this.name = "OutsideRepositoryError"; }
}
