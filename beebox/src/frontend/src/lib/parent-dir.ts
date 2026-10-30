/**
 * The directory a box-relative path sits in: everything before the last `/`,
 * or `""` for a path at the box root.
 */
export function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
