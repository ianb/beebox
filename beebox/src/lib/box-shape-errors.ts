/**
 * Error classes for `box-shape.ts`. Split out purely to keep that file under
 * the 300-line limit — see `box-shape.ts` for how these are thrown.
 */

import * as path from "node:path";

const MIGRATION_POINTER =
  "This box predates the one-root layout (shapeVersion 3). Run `bbx migrate` to convert it. " +
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
      resolvedRoot + " is not a Bee Box: no .beebox/box.json marker there or at its " +
        "content/ subdirectory."
    );
    this.name = "NotABoxError";
  }
}

/** The box's own `package.json` is unreadable. */
export class UnreadablePackageJsonError extends BoxShapeError {
  constructor(boxRoot: string, options: { packageJsonPath: string; cause: unknown }) {
    super(
      "Box at " + boxRoot + " declares shapeVersion 3+ (one-root layout), but it has no " +
        "readable package.json. Expected " + options.packageJsonPath + " declaring a \"beebox\" " +
        "dependency. (" + describeError(options.cause) + ")"
    );
    this.name = "UnreadablePackageJsonError";
  }
}

/** The box's `package.json` doesn't declare a `beebox` dependency. */
export class MissingBeeBoxDependencyError extends BoxShapeError {
  constructor(boxRoot: string, packageJsonPath: string) {
    super(
      "Box at " + boxRoot + " declares shapeVersion 3+ (one-root layout), but " +
        packageJsonPath + " doesn't declare a \"beebox\" dependency (checked dependencies " +
        "and devDependencies)."
    );
    this.name = "MissingBeeBoxDependencyError";
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
