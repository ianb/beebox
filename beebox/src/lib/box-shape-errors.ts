/**
 * Error classes for `box-shape.ts`. Split out purely to keep that file under
 * the 300-line limit — see `box-shape.ts` for how these are thrown.
 */

import * as path from "node:path";
import { errorMessage } from "../shared/error-guards.js";

/**
 * What to tell someone holding a v2 box. There is no longer a command that
 * converts one: every box is shapeVersion 3, the v2 population was emptied on
 * 2026-09-14, and the conversion was deleted with it. So this names the shape
 * and stops, rather than pointing at a `bbx migrate` path that would now say
 * there is nothing to do.
 */
const MIGRATION_POINTER =
  "This box predates the one-root layout (shapeVersion 3) and cannot be opened. " +
  "The v2-to-v3 conversion has been removed — no box was left on that shape. " +
  "See docs/box-layout.md.";

export class BoxShapeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BoxShapeError";
  }
}

/** A v2 PACKAGE root: no marker of its own, but one nested at `content/`. */
export class V2PackageRootError extends BoxShapeError {
  constructor(resolvedRoot: string) {
    super("Box at " + resolvedRoot + " is a v2 package root (marker at content/). " + MIGRATION_POINTER);
    this.name = "V2PackageRootError";
  }
}

/** A marker predating the one-root layout: absent/undefined `shapeVersion`, or `< 3`. */
export class PreV3ShapeError extends BoxShapeError {
  constructor(resolvedRoot: string, shapeVersion: number | undefined) {
    const isLegacyContentDir = path.basename(resolvedRoot) === "content";
    const shapeDescription =
      shapeVersion === undefined
        ? "has a .beebox/box.json marker with no shapeVersion field"
        : "declares shapeVersion " + String(shapeVersion);
    super(
      "Box at " + resolvedRoot + " " + shapeDescription +
        (isLegacyContentDir ? " (a v2 content/ root)" : "") + ". " + MIGRATION_POINTER
    );
    this.name = "PreV3ShapeError";
  }
}

/** A marker declaring a shapeVersion newer than this build understands. */
export class NewerShapeRequiredError extends BoxShapeError {
  constructor(resolvedRoot: string, options: { shapeVersion: number; maxKnownShapeVersion: number }) {
    super(
      "Box at " + resolvedRoot + " declares shapeVersion " + String(options.shapeVersion) +
        ", which this build of beebox doesn't understand (max known: " +
        String(options.maxKnownShapeVersion) + "). The box requires a newer beebox."
    );
    this.name = "NewerShapeRequiredError";
  }
}

/** No box (of any shape) resolves at this path. */
export class NotABoxError extends BoxShapeError {
  constructor(resolvedRoot: string) {
    super(
      resolvedRoot + " is not a Bee Box: a box has a package.json declaring the \"beebox\" " +
        "dependency and a _config/ directory beside it."
    );
    this.name = "NotABoxError";
  }
}

/** A box by identity whose shape version is recorded nowhere: no `package.json` block, no marker. */
export class MissingShapeRecordError extends BoxShapeError {
  constructor(boxRoot: string) {
    super(
      "Box at " + boxRoot + " has no recorded shape version: its package.json has no " +
        "\"beebox\": { \"shapeVersion\": 3, \"created\": \"<ISO date>\" } block and there is no " +
        ".beebox/box.json. If this is a clone of an older box, run `bbx engine migrate` in the " +
        "box it was cloned from, commit, and pull; or copy that box's .beebox/box.json here."
    );
    this.name = "MissingShapeRecordError";
  }
}

/** The box's own `package.json` is unreadable. */
export class UnreadablePackageJsonError extends BoxShapeError {
  constructor(boxRoot: string, options: { packageJsonPath: string; cause: unknown }) {
    super(
      "Box at " + boxRoot + " has no " +
        "readable package.json. Expected " + options.packageJsonPath + " declaring a \"beebox\" " +
        "dependency. (" + errorMessage(options.cause) + ")"
    );
    this.name = "UnreadablePackageJsonError";
  }
}

/** A box `package.json` that parses but is not a JSON object, so no block can be set in it. */
export class PackageJsonNotObjectError extends BoxShapeError {
  constructor() {
    super("The box package.json is not a JSON object, so its \"beebox\" block cannot be written.");
    this.name = "PackageJsonNotObjectError";
  }
}
