// Reading the developer's answer back off disk.
//
// A disposition is an ordinary exhibit document (`data/disposition.json`),
// written by the container and read by everything that reports state: the ask
// queue on the workstreams origin, and the exhibit listings on the exhibits
// origin. Both read it through this module, so "answered" means the same thing
// in both places — a file that parses AND satisfies the schema.

import fs from "node:fs/promises";
import path from "node:path";

import { DISPOSITION_KEY, dispositionSchema } from "../../shared/exhibits.js";

/** Where an exhibit's documents live, relative to its directory. */
export const DATA_DIR = "data";

export interface DispositionRead {
  answered: boolean;
  decidedAt: string | null;
  problem: string | null;
}

const UNANSWERED: DispositionRead = { answered: false, decidedAt: null, problem: null };

/**
 * A disposition that exists but does not parse is reported as unanswered with a
 * problem: the developer's answer is what we cannot see, so claiming "answered"
 * would hide the ask, and claiming nothing would hide the corruption.
 *
 * `exhibitDir` is a directory the caller already resolved under a root; the
 * document itself is lstat-checked, because a symlinked disposition would read
 * (and report on) a file outside the store.
 */
export async function readDisposition(exhibitDir: string): Promise<DispositionRead> {
  const file = path.join(exhibitDir, DATA_DIR, `${DISPOSITION_KEY}.json`);
  if (await fs.lstat(file).then((stats) => stats.isSymbolicLink(), () => false)) {
    return { ...UNANSWERED, problem: "disposition is a symlink; it is refused rather than followed" };
  }
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return UNANSWERED;
    }
    return {
      ...UNANSWERED,
      problem: `disposition unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let parsed: unknown;
  try {
    // eslint-disable-next-line no-restricted-syntax -- JSON.parse is the parse boundary; the result is handed straight to Zod.
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      ...UNANSWERED,
      problem: `disposition is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const result = dispositionSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ...UNANSWERED,
      problem: `disposition is invalid: ${result.error.issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; ")}`,
    };
  }
  return { answered: true, decidedAt: result.data.decidedAt, problem: null };
}
