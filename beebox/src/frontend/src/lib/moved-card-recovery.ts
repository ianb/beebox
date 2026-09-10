import { boxRelativePath } from "@shared/box-path";
import { isRecord } from "@shared/is-record";

export interface CardLoadRecovery {
  kind: "moved";
  path: string;
}

/** Validate the tRPC error boundary before a route treats it as navigation. */
export function cardLoadRecovery(error: unknown): CardLoadRecovery | null {
  if (!isRecord(error)) return null;
  const data = error["data"];
  if (!isRecord(data)) return null;
  const recovery = data["recovery"];
  if (!isRecord(recovery) || recovery["kind"] !== "moved") return null;
  const path = recovery["path"];
  return typeof path === "string" && path.endsWith(".card") ? { kind: "moved", path } : null;
}

/** A directory rename can be the only event an open descendant observes. */
export function fileChangeAffectsPath(
  fileChange: { event: string; path: string },
  viewedPath: string,
): boolean {
  const changed = boxRelativePath(fileChange.path).replace(/\/$/, "");
  const viewed = boxRelativePath(viewedPath);
  if (changed === viewed) return true;
  return fileChange.event === "rename" && changed !== "" && viewed.startsWith(`${changed}/`);
}
