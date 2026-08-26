/**
 * The refusals `cb drive mount` / `link` / `unmount` can return.
 *
 * Every one is a message the person who asked has to read and act on — a
 * mistyped URL, a folder already mounted somewhere else, a directory that is
 * already someone's mount. They share a base class so a caller (CLI, tRPC) can
 * tell "you asked for something we won't do" apart from a Drive outage or a
 * disk error with one `instanceof`, and render `.message` either way.
 */

/** Base for every "we won't do that" from the mount commands. */
export class DriveMountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DriveMountError";
  }
}

export class UnreadableDriveInputError extends DriveMountError {
  readonly input: string;
  constructor(input: string) {
    super(`Could not read a Drive ID from: ${input} — paste a Drive URL or the bare ID`);
    this.name = "UnreadableDriveInputError";
    this.input = input;
  }
}

/**
 * A target that does not name a path inside the box — a `..` that climbs out, a
 * filesystem-absolute path, or the box root itself. Refused before anything is
 * written, so the box never mirrors Drive into someone's home directory.
 */
export class PathOutsideBoxError extends DriveMountError {
  readonly input: string;
  constructor(options: { raw: string; label: string }) {
    super(`${options.label} must be a path inside the box: ${options.raw}`);
    this.name = "PathOutsideBoxError";
    this.input = options.raw;
  }
}

export class NotADriveFolderError extends DriveMountError {
  readonly mimeType: string;
  constructor(options: { name: string; mimeType: string }) {
    super(
      `${options.name} is a ${options.mimeType}, not a Drive folder — use \`cb drive add\` to `
        + "sync a Doc or Sheet, or `cb drive link` to point at it",
    );
    this.name = "NotADriveFolderError";
    this.mimeType = options.mimeType;
  }
}

export class DriveIdClaimedError extends DriveMountError {
  readonly claimedBy: string[];
  constructor(options: { driveId: string; claimedBy: string[] }) {
    super(
      `Drive item ${options.driveId} is already claimed by: ${options.claimedBy.join(", ")} — `
        + "trash or move that card to put it somewhere else",
    );
    this.name = "DriveIdClaimedError";
    this.claimedBy = options.claimedBy;
  }
}

export class DirectoryAlreadyMountedError extends DriveMountError {
  readonly mountCards: string[];
  constructor(options: { relDir: string; mountCards: string[] }) {
    super(
      `${options.relDir} already mirrors another Drive folder `
        + `(${options.mountCards.join(", ")}) — one directory is one mount, so pick another `
        + "directory or unmount that one first",
    );
    this.name = "DirectoryAlreadyMountedError";
    this.mountCards = options.mountCards;
  }
}

export class DriveCardExistsError extends DriveMountError {
  readonly relPath: string;
  constructor(relPath: string) {
    super(`A card already exists at: ${relPath}`);
    this.name = "DriveCardExistsError";
    this.relPath = relPath;
  }
}

export class NoFolderMountHereError extends DriveMountError {
  readonly relDir: string;
  constructor(relDir: string) {
    super(`${relDir} is not a Drive folder mount — it holds no .gfolder.card`);
    this.name = "NoFolderMountHereError";
    this.relDir = relDir;
  }
}

/** Asked to sync a mount by naming something that is not one. */
export class NotAFolderMountError extends DriveMountError {
  readonly relPath: string;
  constructor(relPath: string) {
    super(`${relPath} is not a Drive folder mount card`);
    this.name = "NotAFolderMountError";
    this.relPath = relPath;
  }
}

export class AmbiguousFolderMountError extends DriveMountError {
  readonly mountCards: string[];
  constructor(options: { relDir: string; mountCards: string[] }) {
    super(
      `${options.relDir} holds ${String(options.mountCards.length)} folder mounts `
        + `(${options.mountCards.join(", ")}) — name the one to unmount`,
    );
    this.name = "AmbiguousFolderMountError";
    this.mountCards = options.mountCards;
  }
}
