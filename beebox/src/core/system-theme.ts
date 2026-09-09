import * as fs from "node:fs/promises";
import { glob } from "glob";
import { parse as parseYaml } from "yaml";
import { nearestDirFromDirs } from "./landmark/nearest.js";
import { normalizeLandmarkDir } from "./landmark/root-dir.js";
import { resolveChromeTheme, validateSystemThemeChoice, type PresentationConfigResult, type ResolvedChromeTheme, type ThemeChoice } from "../shared/card-theme.js";
import { resolveBoxNamespacePathOnDisk } from "../lib/box-namespace-resolve.js";
import { splitCardContent } from "../cards/index.js";
import { isRecord } from "../lib/is-record.js";

export interface SelectedSystemThemeLandmark {
  path: string;
  dir: string;
  label: string | null;
  explicitTheme: ThemeChoice | null;
  hasOverride: boolean;
}

export interface ResolvedSystemTheme {
  chrome: ResolvedChromeTheme;
  landmark: SelectedSystemThemeLandmark | null;
}

function landmarkDir(relPath: string): string {
  const slash = relPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : relPath.slice(0, slash);
  return normalizeLandmarkDir(dir === "." ? "" : dir);
}

export async function resolveSystemTheme(input: {
  boxRoot: string;
  contextDir?: string;
  presentation: PresentationConfigResult;
}): Promise<ResolvedSystemTheme> {
  const fallback = resolveChromeTheme(input.presentation);
  if (input.contextDir === undefined) return { chrome: fallback, landmark: null };
  const matches = (await glob("**/*.landmark.card", {
    cwd: input.boxRoot,
    nodir: true,
    ignore: ["node_modules/**", ".git/**", "_tmp/**", ".beebox/**"],
  })).toSorted();
  const nearest = nearestDirFromDirs(`${input.contextDir}/_context`, matches.map(landmarkDir));
  const landmarkPath = matches.find((candidate) => landmarkDir(candidate) === nearest);
  if (landmarkPath === undefined) return { chrome: fallback, landmark: null };
  const resolvedPath = await resolveBoxNamespacePathOnDisk({ boxRoot: input.boxRoot, rawPath: landmarkPath, mode: "read" });
  if (!resolvedPath.ok) return { chrome: fallback, landmark: null };
  const raw = await fs.readFile(resolvedPath.resolved, "utf-8");
  const split = splitCardContent(raw);
  let rawFields: Record<string, unknown> | null = null;
  try {
    const untrusted: unknown = split.hasFrontmatter ? parseYaml(split.frontmatterText) : null;
    rawFields = isRecord(untrusted) ? untrusted : null;
  } catch (error) {
    void error;
  }
  const requestedTheme = rawFields?.["system-theme"];
  const checked = requestedTheme === undefined ? null : validateSystemThemeChoice(requestedTheme);
  const explicitTheme = checked?.problem === null && isRecord(requestedTheme)
    ? { name: String(requestedTheme["name"]), ...(typeof requestedTheme["stock"] === "string" ? { stock: requestedTheme["stock"] } : {}) }
    : null;
  const rawNavigation = isRecord(rawFields?.["navigation"]) ? rawFields["navigation"] : null;
  const landmark = {
    path: landmarkPath,
    dir: nearest,
    label: typeof rawNavigation?.["label"] === "string" ? rawNavigation["label"] : null,
    explicitTheme,
    hasOverride: requestedTheme !== undefined,
  };
  if (requestedTheme === undefined) return { chrome: fallback, landmark };
  const resolved = checked ?? validateSystemThemeChoice(requestedTheme);
  return {
    chrome: { choice: resolved.choice, origin: "landmark" as const, problem: resolved.problem },
    landmark,
  };
}
