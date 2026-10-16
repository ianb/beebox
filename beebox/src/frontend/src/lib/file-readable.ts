/**
 * Check that a picked file's bytes can still be read before it is uploaded.
 *
 * A `File` from a picker is a handle on the disk, not a copy. If the file is
 * moved, deleted or changed after it was picked, every read of it fails. An
 * upload of such a file fails inside the browser's transfer, which reports it
 * as a network error, and the person is told to check a connection that is
 * fine. Reading the first chunk up front turns that into its own outcome.
 *
 * A stream read, not a 1-byte slice: when the file is gone before the browser
 * has measured it, the `File` reports size 0 and a slice of it reads nothing,
 * so the slice "succeeds". The stream still opens the file and fails.
 */

/** The picked file can no longer be read — it was moved, deleted or changed. Retrying will not help. */
export class UnreadableFileError extends Error {
  constructor(opts: { name: string; cause: unknown }) {
    super(`${opts.name} can't be read. It may have been moved or deleted since it was picked.`, { cause: opts.cause });
    this.name = "UnreadableFileError";
  }
}

/** Resolves when the first chunk of `blob` reads; rejects with {@link UnreadableFileError} otherwise. */
export async function assertReadable(blob: Blob, opts: { name: string }): Promise<void> {
  const reader = blob.stream().getReader();
  try {
    await reader.read();
  } catch (e) {
    throw new UnreadableFileError({ name: opts.name, cause: e });
  } finally {
    // Only the first chunk was needed; release the file.
    reader.cancel().catch(() => { /* the stream already errored — nothing to release */ });
  }
}
