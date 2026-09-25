#!/usr/bin/env node --import tsx

import { execFileSync } from "node:child_process";
import { planLifecycleProblems } from "../beebox/src/dev/doc-frontmatter.ts";

interface Options {
  repo: string;
  source: { kind: "index" } | { kind: "tree"; ref: string };
}

class GitBatchError extends Error {
  detail = "";

  constructor() {
    super("Could not read documentation snapshot from Git");
    this.name = "GitBatchError";
  }
}

function gitBatchError(detail: string): GitBatchError {
  const error = new GitBatchError();
  error.detail = detail;
  return error;
}

function usage(): never {
  console.error("usage: bin/doc-lifecycle-check.ts [--repo <path>] (--index | --tree <ref>)");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  let repo = process.cwd();
  let source: Options["source"] | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--repo") {
      const value = argv[++index];
      if (!value) usage();
      repo = value;
    } else if (arg === "--index") {
      if (source) usage();
      source = { kind: "index" };
    } else if (arg === "--tree") {
      const ref = argv[++index];
      if (!ref || source) usage();
      source = { kind: "tree", ref };
    } else {
      usage();
    }
  }
  if (!source) usage();
  return { repo, source };
}

function git(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function batchBlobs(repo: string, objects: string[]): string[] {
  if (objects.length === 0) return [];
  const output = execFileSync("git", ["-C", repo, "cat-file", "--batch"], {
    input: `${objects.join("\n")}\n`,
    maxBuffer: 50 * 1024 * 1024,
  });
  const blobs: string[] = [];
  let offset = 0;
  for (const object of objects) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd === -1) throw gitBatchError(`no header for ${object}`);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    if (header.endsWith(" missing")) throw gitBatchError(`missing object ${object}`);
    const parts = header.split(" ");
    const type = parts.at(-2);
    const size = Number(parts.at(-1));
    if (type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
      throw gitBatchError(`unexpected header for ${object}: ${header}`);
    }
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw gitBatchError(`truncated content for ${object}`);
    }
    blobs.push(output.subarray(contentStart, contentEnd).toString("utf8"));
    offset = contentEnd + 1;
  }
  if (offset !== output.length) throw gitBatchError("unexpected trailing data");
  return blobs;
}

export function lifecycleProblems(options: Options): string[] {
  const { repo, source } = options;
  const listArgs = source.kind === "index"
    ? ["ls-files", "-z", "beebox/docs/plans/*.md", "beebox/docs/implemented-plans/*.md", "beebox/docs/unimplemented-plans/*.md"]
    : ["ls-tree", "-r", "-z", "--name-only", source.ref, "--", "beebox/docs/plans", "beebox/docs/implemented-plans", "beebox/docs/unimplemented-plans"];
  const paths = git(repo, listArgs).split("\0").filter((value) => value.endsWith(".md"));
  const objects = paths.map((rel) => source.kind === "index" ? `:${rel}` : `${source.ref}:${rel}`);
  const sources = batchBlobs(repo, objects);
  return paths.flatMap((rel, index) => planLifecycleProblems({ rel, source: sources[index] ?? "" }));
}

function main(): void {
  let problems: string[];
  try {
    problems = lifecycleProblems(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error("document lifecycle check failed:");
    console.error(`  ${error instanceof GitBatchError ? error.detail : error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  if (problems.length === 0) return;
  console.error("document lifecycle check failed:");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
