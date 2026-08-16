// The "waiting on you" queue: a read-only scan of the exhibit store for the
// workstreams app (Track E of docs/plans/workstream-exhibits.md).
//
// This is the issue-overlay.ts posture — the workstreams origin reads disk and
// never writes it. Answering an ask happens on the exhibits origin, which owns
// the disposition document; here a disposition is just a file that is present
// or absent.
//
// Containment, marker discipline, and manifest parsing are not re-derived: they
// live in exhibits/store.ts and this module calls them (principle 6). Every
// failure below becomes a visible row or a `storeProblem`, never a silent skip.

import fs from "node:fs/promises";
import path from "node:path";

import {
  DISPOSITION_KEY,
  dispositionSchema,
  type AskQueue,
  type AskQueueEntry,
} from "../shared/exhibits.js";
import { DATA_DIR } from "./exhibits/api.js";
import {
  APPS_SEGMENT,
  UninitializedStoreError,
  assertStoreInitialized,
  listRoutableDirs,
  listWorkstreams,
  readManifest,
} from "./exhibits/store.js";
import type { ExhibitsService } from "./services.js";

export interface ExhibitsQueueServiceOptions {
  /** The persistent store root (`workstream-exhibits/`). */
  storeRoot: string;
  /** The main checkout's `dev/apps/`, where committed apps are tracked. */
  appsRoot: string;
  /** Origin of the exhibits listener; links are built from it client-side. */
  origin: string;
}

interface DispositionRead {
  answered: boolean;
  decidedAt: string | null;
  problem: string | null;
}

const UNANSWERED: DispositionRead = { answered: false, decidedAt: null, problem: null };

/**
 * A disposition that exists but does not parse is reported as unanswered with a
 * problem: the developer's answer is what we cannot see, so claiming "answered"
 * would hide the ask, and claiming nothing would hide the corruption.
 */
async function readDisposition(exhibitDataDir: string): Promise<DispositionRead> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(exhibitDataDir, `${DISPOSITION_KEY}.json`), "utf8");
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

interface ScanTarget {
  workstream: string;
  slug: string;
  /** Where the manifest lives — the store, or the checkout for a committed app. */
  manifestDir: string;
  /** Where runtime data lives — always the store. */
  dataDir: string;
  permanent: boolean;
}

async function scanTarget(target: ScanTarget): Promise<AskQueueEntry | null> {
  const base = {
    workstream: target.workstream,
    slug: target.slug,
    path: `/${target.workstream}/${target.slug}/`,
    permanent: target.permanent,
  };
  const manifest = await readManifest(target.manifestDir, { requireAsk: !target.permanent });
  if (!manifest.ok) {
    // A committed app directory without a manifest is not an exhibit at all
    // (dev/apps/ holds whatever the app needs); a store directory without one
    // is a broken exhibit the developer must see.
    if (target.permanent && manifest.missing) return null;
    return {
      ...base,
      title: null,
      ask: null,
      answered: false,
      decidedAt: null,
      problem: `broken manifest: ${manifest.issues.join("; ")}`,
    };
  }
  const ask = manifest.manifest.ask ?? null;
  // An app with no ask is a durable tool, not a question: nothing waits on it.
  if (ask === null) return null;
  const disposition = await readDisposition(path.join(target.dataDir, DATA_DIR));
  return {
    ...base,
    title: manifest.manifest.title,
    ask,
    answered: disposition.answered,
    decidedAt: disposition.decidedAt,
    problem: disposition.problem,
  };
}

async function scanWorkstreams(storeRoot: string): Promise<AskQueueEntry[]> {
  const entries: AskQueueEntry[] = [];
  for (const workstream of await listWorkstreams(storeRoot)) {
    const workstreamDir = path.join(storeRoot, workstream);
    for (const slug of await listRoutableDirs(workstreamDir)) {
      const dir = path.join(workstreamDir, slug);
      const entry = await scanTarget({
        workstream,
        slug,
        manifestDir: dir,
        dataDir: dir,
        permanent: false,
      });
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/** Committed apps: manifest in the checkout, data in the store's `apps/` tier. */
async function scanApps(options: { appsRoot: string; storeRoot: string }): Promise<AskQueueEntry[]> {
  const entries: AskQueueEntry[] = [];
  for (const name of await listRoutableDirs(options.appsRoot)) {
    const entry = await scanTarget({
      workstream: APPS_SEGMENT,
      slug: name,
      manifestDir: path.join(options.appsRoot, name),
      dataDir: path.join(options.storeRoot, APPS_SEGMENT, name),
      permanent: true,
    });
    if (entry) entries.push(entry);
  }
  return entries;
}

export function createExhibitsQueueService(options: ExhibitsQueueServiceOptions): ExhibitsService {
  return {
    async askQueue(): Promise<AskQueue> {
      let storeProblem: string | null = null;
      let workstreamEntries: AskQueueEntry[] = [];
      try {
        await assertStoreInitialized(options.storeRoot);
        workstreamEntries = await scanWorkstreams(options.storeRoot);
      } catch (error) {
        if (!(error instanceof UninitializedStoreError)) throw error;
        // No store yet is a normal state on a fresh checkout, but the queue says
        // so rather than rendering a confident "nothing waiting".
        storeProblem = `No exhibit store yet: ${options.storeRoot} has no marker file. Run bin/exhibits to create one.`;
      }
      const appEntries = await scanApps({ appsRoot: options.appsRoot, storeRoot: options.storeRoot });
      return {
        origin: options.origin,
        storeProblem,
        entries: [...workstreamEntries, ...appEntries],
      };
    },
  };
}
