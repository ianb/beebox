/**
 * The TypeScript 7 `tsc` binary, for callers that emit JavaScript: the 7.0 API
 * has no transpile call (`docs/plans/typescript-7.md`, Track C).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { isRecord } from "../../shared/is-record.js";

/** `@typescript/native/package.json` has no `bin.tsc` string. */
export class TscBinaryNotFoundError extends Error {
  readonly packageJsonPath: string;
  constructor(packageJsonPath: string) {
    super(`No bin.tsc in ${packageJsonPath}`);
    this.name = "TscBinaryNotFoundError";
    this.packageJsonPath = packageJsonPath;
  }
}

/**
 * Absolute path of the `tsc` script. The package's `exports` lists
 * `./package.json` but not `./bin/tsc`, so this reads the `bin` entry.
 */
export function tscBinary(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("@typescript/native/package.json");
  const manifest: unknown = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const bin = isRecord(manifest) ? manifest["bin"] : undefined;
  const tsc = isRecord(bin) ? bin["tsc"] : undefined;
  if (typeof tsc !== "string") throw new TscBinaryNotFoundError(packageJsonPath);
  return path.join(path.dirname(packageJsonPath), tsc);
}
