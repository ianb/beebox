/**
 * The ways a git-annex migration can refuse.
 *
 * Split out of to-annex.ts to keep that file focused on the sequence. Each of
 * these represents a state where converting would destroy the evidence needed
 * to notice a problem later — so they are refusals, not warnings, and every one
 * of them fired at least once against a real box during development.
 */

function mb(bytes: number): string {
  return String(Math.round(bytes / (1024 * 1024)));
}

/**
 * An asset's bytes on disk are Git LFS pointer text, not content.
 *
 * Distinct from {@link LfsContentMissingError}, which covers files git *knows*
 * are LFS-tracked. This catches the sneakier case: a **gitignored** asset whose
 * on-disk content happens to be a pointer. git never applied a filter to it (it
 * was ignored), so `git lfs ls-files` does not list it and nothing would smudge
 * it — it just sits there looking like a 131-byte photo. Annexing it would mint
 * a key over the pointer text and bless it as canonical content forever.
 *
 * Found on a real box: `estate-copy` had ~1,100 assets in exactly this state.
 */
export class AssetIsLfsPointerError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} asset(s) contain Git LFS pointer text instead of their bytes. ` +
        "Annexing them would record the pointer as the content:\n" +
        paths.slice(0, 5).map((p) => `  ${p}`).join("\n") +
        "\nMaterialize them first (`git lfs checkout`, or `git lfs pull` if they must be " +
        "fetched). If the objects are simply gone, this box's assets are already lost and " +
        "converting will not recover them.",
    );
    this.name = "AssetIsLfsPointerError";
    this.paths = paths;
  }
}

/** Git LFS content was missing locally, so converting would lose it. */
export class LfsContentMissingError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} Git LFS file(s) are still pointers locally. Converting now would ` +
        "commit the pointer text as the file. Run `git lfs pull` first:\n" +
        paths.slice(0, 5).map((p) => `  ${p}`).join("\n"),
    );
    this.name = "LfsContentMissingError";
    this.paths = paths;
  }
}

/** The working tree had uncommitted changes, so a failed run could not be cleanly undone. */
export class DirtyTreeError extends Error {
  constructor(status: string) {
    super(`working tree is not clean; commit or stash first:\n${status}`);
    this.name = "DirtyTreeError";
  }
}

/** Manifests disagreed with the bytes on disk BEFORE conversion. */
export class PreflightManifestError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `${String(problems.length)} asset(s) fail manifest verification. Converting now would ` +
        `bless whatever is on disk as canonical:\n${problems.join("\n")}`,
    );
    this.name = "PreflightManifestError";
    this.problems = problems;
  }
}

/** Not enough disk for the annex objects the conversion will create. */
export class InsufficientSpaceError extends Error {
  constructor(needBytes: number, freeBytes: number) {
    super(
      `conversion needs about ${mb(needBytes)} MB of additional space (annex.thin=false keeps ` +
        `a working-tree copy AND an object copy) but only ${mb(freeBytes)} MB is free.`,
    );
    this.name = "InsufficientSpaceError";
  }
}

/**
 * Assets are still gitignored, so `git add` would never see them.
 *
 * This is the root cause of the worst failure this migration can have: the
 * conversion "succeeds", the manifests are deleted, and the bytes end up
 * tracked by nothing at all. Caught before anything is written.
 */
export class AssetsStillIgnoredError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} asset(s) are still gitignored, so git-annex would never see ` +
        "them. Run `bbx attachments unignore` first (and clear any hand-written asset " +
        `rules it reports):\n${paths.slice(0, 5).map((p) => `  ${p}`).join("\n")}`,
    );
    this.name = "AssetsStillIgnoredError";
    this.paths = paths;
  }
}

/** After staging, some assets did not actually end up annexed. */
export class NotAnnexedError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super(
      `${String(paths.length)} asset(s) were not annexed by \`git add\`. Manifests have NOT ` +
        `been removed:\n${paths.slice(0, 5).map((p) => `  ${p}`).join("\n")}`,
    );
    this.name = "NotAnnexedError";
    this.paths = paths;
  }
}

/** An annexed object's hash does not match what the manifest claimed. */
export class PostConversionMismatchError extends Error {
  readonly mismatches: string[];
  constructor(mismatches: string[]) {
    super(
      `${String(mismatches.length)} asset(s) annexed under a key that disagrees with their ` +
        `manifest hash. Manifests have NOT been removed:\n${mismatches.join("\n")}`,
    );
    this.name = "PostConversionMismatchError";
    this.mismatches = mismatches;
  }
}
