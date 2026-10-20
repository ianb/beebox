import { resolve } from "node:path";

/**
 * A discovery run's intermediate files live at the monorepo root, outside `beebox/`, beside the
 * journey-walk runs. A box's `node_modules/beebox` links to the dev checkout's `beebox/`, so
 * anything under it is readable by a box agent. The root `.gitignore` covers `/user-stories-work/`.
 *
 * The `*.workflow.ts` scripts cannot import this (see `workflow-globals.d.ts`); each spells the
 * same path as `${ROOT}/user-stories-work/discovery`.
 */
export const DISCOVERY_WORK = resolve(import.meta.dirname, "../../../..", "user-stories-work", "discovery");
