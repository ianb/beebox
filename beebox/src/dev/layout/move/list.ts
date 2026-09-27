/**
 * Parses a move list's JSON shape: `{ "moves": [{ "from": "...", "to": "..." }] }`.
 * Other top-level keys are ignored. `validate.ts` checks the paths themselves.
 */
import { errorMessage } from "../../../shared/error-guards.js";
import { isRecord } from "../../../shared/is-record.js";

export interface PlannedMove {
  from: string;
  to: string;
}

export class MoveListNotJsonError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super("move list is not valid JSON");
    this.name = "MoveListNotJsonError";
    this.reason = reason;
  }
}

export class MoveListShapeError extends Error {
  constructor() {
    super('expected a { "moves": [...] } object');
    this.name = "MoveListShapeError";
  }
}

export class MoveEntryNotObjectError extends Error {
  readonly index: number;
  constructor(index: number) {
    super("moves[] entry is not an object");
    this.name = "MoveEntryNotObjectError";
    this.index = index;
  }
}

export class MoveEntryMissingFromError extends Error {
  readonly index: number;
  constructor(index: number) {
    super("moves[].from must be a non-empty string");
    this.name = "MoveEntryMissingFromError";
    this.index = index;
  }
}

export class MoveEntryMissingToError extends Error {
  readonly index: number;
  constructor(index: number) {
    super("moves[].to must be a non-empty string");
    this.name = "MoveEntryMissingToError";
    this.index = index;
  }
}

function parseMove(value: unknown, index: number): PlannedMove {
  if (!isRecord(value)) throw new MoveEntryNotObjectError(index);
  const { from, to } = value;
  if (typeof from !== "string" || from.length === 0) throw new MoveEntryMissingFromError(index);
  if (typeof to !== "string" || to.length === 0) throw new MoveEntryMissingToError(index);
  return { from, to };
}

export function parseMoveList(raw: string): PlannedMove[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new MoveListNotJsonError(errorMessage(e));
  }
  if (!isRecord(json) || !Array.isArray(json["moves"])) throw new MoveListShapeError();
  return json["moves"].map((m: unknown, i) => parseMove(m, i));
}
