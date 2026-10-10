// The exhibit inventory: a read-only scan of the exhibit store for the
// workstreams app (Track 5 of docs/implemented-plans/exhibits-rethink.md).
//
// This is the issue-overlay.ts posture: the workstreams origin reads disk and
// never writes it. Committed apps belong to no workstream and are not listed.
//
// Containment, marker discipline, and manifest parsing are not re-derived: they
// live in exhibits/store.ts and this module calls them (principle 6). Every
// failure below becomes a visible row or a `storeProblem`, never a silent skip.

import path from "node:path";

import type { ExhibitInventory, ExhibitInventoryEntry } from "../../shared/exhibits.js";
import {
  UninitializedStoreError,
  assertStoreInitialized,
  listRoutableDirs,
  listWorkstreams,
  readManifest,
} from "../exhibits/store.js";
import type { ExhibitsService } from "../services.js";

export interface ExhibitsInventoryServiceOptions {
  /** The persistent store root (`workstream-exhibits/`). */
  storeRoot: string;
  /** Origin of the exhibits listener; links are built from it client-side. */
  origin: string;
}

async function scanExhibit(options: { workstream: string; slug: string; dir: string }): Promise<ExhibitInventoryEntry> {
  const base = {
    workstream: options.workstream,
    slug: options.slug,
    path: `/${options.workstream}/${options.slug}/`,
  };
  const manifest = await readManifest(options.dir);
  if (!manifest.ok) {
    return { ...base, title: null, created: null, problem: `broken manifest: ${manifest.issues.join("; ")}` };
  }
  return { ...base, title: manifest.manifest.title, created: manifest.manifest.created, problem: null };
}

async function scanWorkstreams(storeRoot: string): Promise<ExhibitInventoryEntry[]> {
  const entries: ExhibitInventoryEntry[] = [];
  for (const workstream of await listWorkstreams(storeRoot)) {
    const workstreamDir = path.join(storeRoot, workstream);
    for (const slug of await listRoutableDirs(workstreamDir)) {
      entries.push(await scanExhibit({ workstream, slug, dir: path.join(workstreamDir, slug) }));
    }
  }
  return entries;
}

export function createExhibitsInventoryService(options: ExhibitsInventoryServiceOptions): ExhibitsService {
  return {
    async inventory(): Promise<ExhibitInventory> {
      let storeProblem: string | null = null;
      let entries: ExhibitInventoryEntry[] = [];
      try {
        await assertStoreInitialized(options.storeRoot);
        entries = await scanWorkstreams(options.storeRoot);
      } catch (error) {
        if (!(error instanceof UninitializedStoreError)) throw error;
        // No store yet is a normal state on a fresh checkout, but the inventory
        // says so rather than rendering a confident "no exhibits".
        storeProblem = `No exhibit store yet: ${options.storeRoot} has no marker file. Run bin/exhibits to create one.`;
      }
      return { origin: options.origin, storeProblem, entries };
    },
  };
}
