/**
 * Which place's identity a `file-change` can have changed
 * (`PlacePill`): the directory holding a changed `*.landmark.card`, in the
 * same box-relative form `landmarks.identity` takes (`""` is the box root).
 * `null` for any other file, so the pill refetches nothing for them.
 */

import { boxRelativePath } from "@shared/box-path";
import { parentDir } from "../../lib/parent-dir";

export function landmarkDirOfChange(changedPath: string): string | null {
  const relative = boxRelativePath(changedPath);
  if (!relative.endsWith(".landmark.card")) return null;
  return parentDir(relative);
}
