/**
 * File identity — the client's defense against a scanner that replaces or
 * appends to a file between the uploader reading EOF and applying a
 * disposition. Nanosecond-precision mtime plus dev/inode/size is the
 * strongest signal Node's fs API exposes without reading bytes again.
 */

import { stat } from "node:fs/promises";

export interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}

export async function snapshotIdentity(filePath: string): Promise<FileIdentity> {
  const stats = await stat(filePath, { bigint: true });
  return { dev: stats.dev, ino: stats.ino, size: stats.size, mtimeNs: stats.mtimeNs };
}

export function identityEquals(a: FileIdentity, b: FileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs;
}
