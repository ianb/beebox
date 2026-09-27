/**
 * Validates a move list before anything is touched: every `from` exists and
 * is tracked, no `to` exists, no duplicate `from`/`to`, and a chain is
 * ordered rather than rejected. Two chain shapes exist, and they order
 * opposite ways: a move whose `from` doesn't exist yet (because another
 * move's `to` produces it) runs after that producer; a move whose `to` is
 * currently occupied (because another move's `from` is that same path) runs
 * after the move that vacates it. Both are decided against the REAL tracked
 * set, not move-list order, since only one of the two shapes ever applies to
 * a given pair.
 */
import { gitTrackedFiles } from "./git-ops.js";
import type { PlannedMove } from "./list.js";

export class DuplicateMoveSourceError extends Error {
  readonly path: string;
  constructor(path: string) {
    super("two moves share the same `from`");
    this.name = "DuplicateMoveSourceError";
    this.path = path;
  }
}

export class DuplicateMoveTargetError extends Error {
  readonly path: string;
  constructor(path: string) {
    super("two moves share the same `to`");
    this.name = "DuplicateMoveTargetError";
    this.path = path;
  }
}

export class MoveChainCycleError extends Error {
  readonly moves: string;
  constructor(moves: string) {
    super("moves form a cycle and cannot be ordered");
    this.name = "MoveChainCycleError";
    this.moves = moves;
  }
}

export class MoveSourceMissingError extends Error {
  readonly path: string;
  constructor(path: string) {
    super("`from` does not exist as a tracked file (and no other move produces it first)");
    this.name = "MoveSourceMissingError";
    this.path = path;
  }
}

export class MoveTargetExistsError extends Error {
  readonly path: string;
  constructor(path: string) {
    super("`to` already exists");
    this.name = "MoveTargetExistsError";
    this.path = path;
  }
}

function checkDuplicates(moves: PlannedMove[]): void {
  const froms = new Set<string>();
  const tos = new Set<string>();
  for (const move of moves) {
    if (froms.has(move.from)) throw new DuplicateMoveSourceError(move.from);
    froms.add(move.from);
    if (tos.has(move.to)) throw new DuplicateMoveTargetError(move.to);
    tos.add(move.to);
  }
}

/**
 * Each move's predecessors: the move that must run first, for either chain
 * shape. A move's `from` missing from the real tracked set means some other
 * move produces it (its `to` matches); a move's `to` present in the real
 * tracked set means some other move must vacate it first (its `from`
 * matches). Absent a matching move either check is left to `checkExistence`,
 * which reports the ordinary missing-source/target-exists failure.
 */
function predecessorsOf(params: { moves: PlannedMove[]; realTracked: ReadonlySet<string> }): Map<PlannedMove, PlannedMove[]> {
  const byFrom = new Map(params.moves.map((m) => [m.from, m] as const));
  const byTo = new Map(params.moves.map((m) => [m.to, m] as const));
  const predecessors = new Map<PlannedMove, PlannedMove[]>();
  for (const move of params.moves) {
    const list: PlannedMove[] = [];
    if (!params.realTracked.has(move.from)) {
      const producer = byTo.get(move.from);
      if (producer !== undefined) list.push(producer);
    }
    if (params.realTracked.has(move.to)) {
      const vacator = byFrom.get(move.to);
      if (vacator !== undefined) list.push(vacator);
    }
    predecessors.set(move, list);
  }
  return predecessors;
}

/** Orders `moves` so every move's predecessors (`predecessorsOf`) run first. */
function orderByChain(params: { moves: PlannedMove[]; realTracked: ReadonlySet<string> }): PlannedMove[] {
  const predecessors = predecessorsOf(params);
  const placed = new Set<PlannedMove>();
  const remaining = [...params.moves];
  const order: PlannedMove[] = [];
  let progressed = true;
  while (remaining.length > 0 && progressed) {
    progressed = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const move = remaining[i];
      if (move === undefined) continue;
      const waiting = (predecessors.get(move) ?? []).some((p) => !placed.has(p));
      if (waiting) continue;
      order.push(move);
      placed.add(move);
      remaining.splice(i, 1);
      progressed = true;
    }
  }
  if (remaining.length > 0) {
    throw new MoveChainCycleError(remaining.map((m) => `${m.from}->${m.to}`).join(", "));
  }
  return order;
}

/** Simulates the ordered moves against the real tracked set, so a chained path is accepted at its turn. */
function checkExistence(params: { ordered: PlannedMove[]; realTracked: ReadonlySet<string> }): void {
  const virtual = new Set(params.realTracked);
  for (const move of params.ordered) {
    if (!virtual.has(move.from)) throw new MoveSourceMissingError(move.from);
    if (virtual.has(move.to)) throw new MoveTargetExistsError(move.to);
    virtual.delete(move.from);
    virtual.add(move.to);
  }
}

/** Validates `moves` and returns them in an order safe to apply (chain-vacating and chain-producing moves first). */
export function validateMoveList(params: { moves: PlannedMove[]; repoRoot: string }): PlannedMove[] {
  checkDuplicates(params.moves);
  const relevantPaths = [...new Set(params.moves.flatMap((m) => [m.from, m.to]))];
  const realTracked = gitTrackedFiles({ repoRoot: params.repoRoot, paths: relevantPaths });
  const ordered = orderByChain({ moves: params.moves, realTracked });
  checkExistence({ ordered, realTracked });
  return ordered;
}
