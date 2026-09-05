/**
 * The comment store's path refusals.
 *
 * Split out of `comments-store.ts` as a pure move. Containment is the store's
 * only security property — a `..` segment or a symlinked ancestor is a write
 * outside the store — so every refusal is one named error whose wording is
 * composed here, never at a throw site.
 */

/**
 * Why a path was refused. One class rather than a subclass per case: the store
 * doctest reads `error.name`, and callers branch on `reason.kind` — the wording
 * is composed here so no throw site carries message text.
 */
export type CommentPathRefusal =
  | { kind: "empty" }
  | { kind: "absolute"; relPath: string }
  | { kind: "escapes"; relPath: string }
  | { kind: "unnormalized"; relPath: string }
  | { kind: "bad-worktree-name"; worktree: string }
  | { kind: "outside-store"; relPath: string }
  | { kind: "symlinked-ancestor"; at: string }
  | { kind: "unreadable-append"; problem: string }
  | { kind: "unreadable-clear"; problem: string };

function refusalDetail(reason: CommentPathRefusal): string {
  switch (reason.kind) {
    case "empty":
      return "empty path";
    case "absolute":
      return `absolute path: ${reason.relPath}`;
    case "escapes":
      return `path escapes the repository: ${reason.relPath}`;
    case "unnormalized":
      return `path is not normalized: ${reason.relPath}`;
    case "bad-worktree-name":
      return `not a worktree name: ${reason.worktree}`;
    case "outside-store":
      return `resolves outside the store: ${reason.relPath}`;
    case "symlinked-ancestor":
      return `${reason.at} is a symlink; refusing to follow it out of the store`;
    case "unreadable-append":
      return `refusing to append over an unreadable file — ${reason.problem}`;
    case "unreadable-clear":
      return `refusing to clear an unreadable file — ${reason.problem}`;
  }
}

export class InvalidCommentPathError extends Error {
  constructor(readonly reason: CommentPathRefusal) {
    super(`invalid comment path: ${refusalDetail(reason)}`);
    this.name = "InvalidCommentPathError";
  }
}
