/**
 * The holder: one process per box owner, run as that owner, that closes its
 * boxes for maintenance and keeps them closed while the controller
 * (`controller.ts`) runs the trusted deployment command as root.
 *
 * Why a process and not a `seteuid` in the controller: on a unit host
 * (docs/plans/per-box-units.md) every box has its own user, and the gate
 * files under a box's Git directory must belong to that user. One process can
 * wear one identity at a time, so the controller spawns one of these per
 * owner and keeps root for itself. A host with one owner for every box runs
 * one holder; the protocol is the same.
 *
 * Protocol, newline-delimited JSON on the holder's stdio:
 *   holder → controller  `{ "permits": { "<root>": "<permit>" } }` once every
 *                        box is closed, drained, snapshotted and exclusive.
 *   controller → holder  `{ "complete": ["<root>", ...] }` naming the boxes
 *                        the controller verified; the holder completes those
 *                        and releases the rest.
 * The controller's exit closes the holder's stdin: EOF releases every box, so
 * a controller that dies cannot leave a box held by a live owner.
 */

import { createInterface } from "node:readline";
import { z } from "zod";
import { captureMigrationSnapshot } from "../../../core/migration-recovery.js";
import { boxMaintenanceStatus, boxWorkEnvironment, closeBoxMaintenance, type BoxMaintenance } from "../../../lib/box-maintenance/admission.js";
import { errorMessage } from "../../../shared/error-guards.js";

export const holderReportSchema = z.object({ permits: z.record(z.string(), z.string()) });
export const holderVerdictSchema = z.object({ complete: z.array(z.string()) });

/** The first line of `stream`, or null when it ends first. */
async function readLine(stream: NodeJS.ReadableStream): Promise<string | null> {
  const lines = createInterface({ input: stream });
  try {
    for await (const line of lines) return line;
    return null;
  } finally {
    lines.close();
  }
}

/** Exit code: 0 when every box completed, 1 otherwise. */
export async function holdBoxes(roots: readonly string[], opts: { reason: string; input: NodeJS.ReadableStream; output: NodeJS.WritableStream }): Promise<number> {
  const held: { root: string; handle: BoxMaintenance }[] = [];
  const completed = new Set<string>();
  try {
    for (const root of roots) held.push({ root, handle: await closeBoxMaintenance(root, { reason: opts.reason }) });
    for (const { handle } of held) await handle.drain();
    for (const { root, handle } of held) {
      const snapshot = await handle.run(() => captureMigrationSnapshot(root, opts.reason));
      console.error(`Deployment recovery snapshot: ${root} ${snapshot.ref}`);
    }
    for (const { handle } of held) await handle.beginChanges();
    const permits = Object.fromEntries(held.map(({ root, handle }) => [root, handle.run(boxWorkEnvironment).BBX_BOX_WORK]));
    opts.output.write(`${JSON.stringify(holderReportSchema.parse({ permits }))}\n`);

    const line = await readLine(opts.input);
    if (line === null) {
      console.error("Maintenance controller went away before a verdict; reopening every box as unfinished maintenance.");
      return 1;
    }
    const verdict = holderVerdictSchema.parse(JSON.parse(line));
    let code = 0;
    for (const { root, handle } of held) {
      try {
        const ready = (await boxMaintenanceStatus(root))?.phase === "ready";
        if (ready && verdict.complete.includes(root)) {
          await handle.complete();
          completed.add(root);
        } else {
          console.error(`Box not verified; it reopens with unfinished maintenance: ${root}`);
          code = 1;
        }
      } catch (error) {
        console.error(`Box completion failed for ${root}: ${errorMessage(error)}`);
        code = 1;
      }
    }
    return code;
  } finally {
    for (const { root, handle } of held.toReversed()) {
      if (completed.has(root)) continue;
      try {
        // Ready is a promise backed by a live owner, never a failed terminal state.
        if ((await boxMaintenanceStatus(root))?.phase === "ready") await handle.beginChanges();
      } finally { await handle.release(); }
    }
  }
}
