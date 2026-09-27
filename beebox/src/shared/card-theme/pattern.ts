/** Validate the deliberately small path-pattern language used by theme rules. */
export function validateThemePattern(pattern: string): string | null {
  if (pattern.length === 0) return "pattern must not be empty";
  if (pattern.startsWith("/")) return "pattern must be box-relative (no leading slash)";
  if (pattern.endsWith("/")) return "pattern must name a path, not a directory suffix";
  if (
    pattern.includes("?")
    || pattern.includes("[")
    || pattern.includes("]")
    || pattern.includes("{")
    || pattern.includes("}")
    || pattern.includes("!")
    || pattern.includes("\\")
  ) return "pattern uses unsupported glob syntax";
  const segments = pattern.split("/");
  if (segments.some((segment) => segment.length === 0)) return "pattern must not contain empty path segments";
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "pattern must not contain . or .. path segments";
  }
  if (segments.some((segment) => segment.includes("**") && segment !== "**")) {
    return "** must occupy a complete path segment";
  }
  return null;
}

function segmentMatches(pattern: string, value: string): boolean {
  const memo = new Map<string, boolean>();
  function matches(patternIndex: number, valueIndex: number): boolean {
    const key = `${patternIndex}:${valueIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (patternIndex === pattern.length) {
      result = valueIndex === value.length;
    } else if (pattern[patternIndex] === "*") {
      result = matches(patternIndex + 1, valueIndex)
        || (valueIndex < value.length && matches(patternIndex, valueIndex + 1));
    } else {
      result = valueIndex < value.length
        && pattern[patternIndex] === value[valueIndex]
        && matches(patternIndex + 1, valueIndex + 1);
    }
    memo.set(key, result);
    return result;
  }
  return matches(0, 0);
}

/** Match a validated, box-relative presentation rule against one card path. */
export function themePatternMatches(pattern: string, cardPath: string): boolean {
  if (validateThemePattern(pattern) !== null) return false;
  if (cardPath.startsWith("/") || cardPath.split("/").includes("..")) return false;
  const patternSegments = pattern.split("/");
  const pathSegments = cardPath.split("/");
  const memo = new Map<string, boolean>();
  function matches(patternIndex: number, pathIndex: number): boolean {
    const key = `${patternIndex}:${pathIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let result: boolean;
    if (patternIndex === patternSegments.length) {
      result = pathIndex === pathSegments.length;
    } else if (patternSegments[patternIndex] === "**") {
      result = matches(patternIndex + 1, pathIndex)
        || (pathIndex < pathSegments.length && matches(patternIndex, pathIndex + 1));
    } else {
      result = pathIndex < pathSegments.length
        && segmentMatches(patternSegments[patternIndex] ?? "", pathSegments[pathIndex] ?? "")
        && matches(patternIndex + 1, pathIndex + 1);
    }
    memo.set(key, result);
    return result;
  }
  return matches(0, 0);
}
