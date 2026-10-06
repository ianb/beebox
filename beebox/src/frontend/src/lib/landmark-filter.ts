/**
 * The Landmarks page's filter (docs/plans/box-screen.md, track 3): the rows of
 * `landmarks.list` whose label or directory contains the text, each kept with
 * its ancestor landmarks so the result reads in the same indented form as the
 * whole hierarchy. Empty text keeps every row.
 *
 * `list` orders rows root first, then by directory, and gives each a `depth`
 * relative to its nearest ancestor landmark; the filter keeps that order and
 * those depths. An ancestor is a landmark whose directory contains the
 * match's directory. The root landmark is not a parent (depth stays 0 under
 * it), so a match keeps the root only when the root itself matches.
 */

interface FilterableLandmark {
  dir: string;
  label: string;
}

function isAncestorDir(ancestor: string, dir: string): boolean {
  return ancestor !== "" && dir.startsWith(`${ancestor}/`);
}

export function filterLandmarks<T extends FilterableLandmark>(landmarks: readonly T[], text: string): T[] {
  const query = text.trim().toLocaleLowerCase();
  if (query === "") return [...landmarks];
  const matches = landmarks.filter((landmark) => `${landmark.label}\n${landmark.dir}`.toLocaleLowerCase().includes(query));
  return landmarks.filter((landmark) =>
    matches.some((match) => match === landmark || isAncestorDir(landmark.dir, match.dir)));
}
