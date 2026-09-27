/**
 * Specifier resolution: relative and tsconfig-aliased import specifiers to
 * repo-relative file paths, checked against the real filesystem.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as posixPath from "node:path/posix";
import ts from "typescript";
import { isRecord } from "../../../shared/is-record.js";
import { dirOf } from "../graph.js";

/** Join `relative` onto `fromDir` and normalize; no existence check. */
export function resolveRepoRelative(params: { fromDir: string; relative: string }): string {
  return posixPath.normalize(posixPath.join(params.fromDir, params.relative));
}

interface AliasEntry {
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  targets: string[];
}

export interface Aliases {
  /** Repo-relative directory `paths` targets resolve against. */
  baseDir: string;
  entries: AliasEntry[];
}

function buildAliasEntry(key: string, targets: string[]): AliasEntry {
  const star = key.indexOf("*");
  if (star === -1) return { prefix: key, suffix: "", hasWildcard: false, targets };
  return { prefix: key.slice(0, star), suffix: key.slice(star + 1), hasWildcard: true, targets };
}

function readTsconfig(absPath: string): unknown {
  if (!existsSync(absPath)) return null;
  const result = ts.readConfigFile(absPath, (path) => readFileSync(path, "utf8"));
  if (result.error !== undefined) return null;
  return result.config;
}

function extractPaths(compilerOptions: Record<string, unknown>): Record<string, string[]> {
  const raw = compilerOptions["paths"];
  if (!isRecord(raw)) return {};
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!Array.isArray(value)) continue;
    const strings = value.filter((entry): entry is string => typeof entry === "string");
    if (strings.length > 0) result[key] = strings;
  }
  return result;
}

function extractBaseUrl(compilerOptions: Record<string, unknown>): string | null {
  const raw = compilerOptions["baseUrl"];
  return typeof raw === "string" ? raw : null;
}

export function loadAliases(params: { repoRoot: string; packageRoot: string }): Aliases {
  const config = readTsconfig(join(params.repoRoot, params.packageRoot, "tsconfig.json"));
  const compilerOptionsRaw = isRecord(config) ? config["compilerOptions"] : null;
  const compilerOptions = isRecord(compilerOptionsRaw) ? compilerOptionsRaw : {};
  const baseUrl = extractBaseUrl(compilerOptions);
  const baseDir =
    baseUrl === null
      ? params.packageRoot
      : resolveRepoRelative({ fromDir: params.packageRoot, relative: baseUrl });
  const entries = Object.entries(extractPaths(compilerOptions)).map(([key, targets]) =>
    buildAliasEntry(key, targets),
  );
  return { baseDir, entries };
}

const JS_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx"];
const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const APPEND_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js"];

function candidatesFor(target: string): string[] {
  const candidates = [target];
  const jsExt = JS_EXTENSIONS.find((ext) => target.endsWith(ext));
  if (jsExt !== undefined) {
    const base = target.slice(0, -jsExt.length);
    for (const tsExt of TS_EXTENSIONS) candidates.push(base + tsExt);
  }
  for (const ext of APPEND_EXTENSIONS) candidates.push(target + ext);
  candidates.push(`${target}/index.ts`, `${target}/index.tsx`);
  return candidates;
}

/** `existsSync` plus a directory check: a set/list resolution must land on a file, never its own directory. */
export function isRepoFile(absPath: string): boolean {
  return existsSync(absPath) && statSync(absPath).isFile();
}

function resolveRelative(params: { fromDir: string; specifier: string; repoRoot: string }): string | null {
  const target = resolveRepoRelative({ fromDir: params.fromDir, relative: params.specifier });
  for (const candidate of candidatesFor(target)) {
    if (isRepoFile(join(params.repoRoot, candidate))) return candidate;
  }
  return null;
}

function matchAlias(specifier: string, entry: AliasEntry): string | null {
  if (!entry.hasWildcard) return specifier === entry.prefix ? "" : null;
  if (specifier.length < entry.prefix.length + entry.suffix.length) return null;
  if (!specifier.startsWith(entry.prefix) || !specifier.endsWith(entry.suffix)) return null;
  return specifier.slice(entry.prefix.length, specifier.length - entry.suffix.length);
}

interface AliasResolution {
  matched: boolean;
  target: string | null;
}

function resolveAlias(params: { specifier: string; aliases: Aliases; repoRoot: string }): AliasResolution {
  for (const entry of params.aliases.entries) {
    const wildcard = matchAlias(params.specifier, entry);
    if (wildcard === null) continue;
    for (const targetPattern of entry.targets) {
      const substituted = entry.hasWildcard ? targetPattern.replace("*", wildcard) : targetPattern;
      const resolved = resolveRelative({
        fromDir: params.aliases.baseDir,
        specifier: substituted,
        repoRoot: params.repoRoot,
      });
      if (resolved !== null) return { matched: true, target: resolved };
    }
    return { matched: true, target: null };
  }
  return { matched: false, target: null };
}

export interface ResolvedImport {
  target: string | null;
  external: boolean;
}

export function resolveImport(params: {
  specifier: string;
  importerPath: string;
  repoRoot: string;
  aliases: Aliases;
}): ResolvedImport {
  if (params.specifier.startsWith(".")) {
    // A bundler query suffix (Vite's `?url`, `?raw`, `?worker`, ...) is not
    // part of the file's identity on disk; strip it before resolving.
    const path = params.specifier.split("?")[0] ?? params.specifier;
    const target = resolveRelative({ fromDir: dirOf(params.importerPath), specifier: path, repoRoot: params.repoRoot });
    return { target, external: false };
  }
  const alias = resolveAlias({ specifier: params.specifier, aliases: params.aliases, repoRoot: params.repoRoot });
  if (alias.matched) return { target: alias.target, external: false };
  return { target: null, external: true };
}
