// A box with three places for the intention review tests: the root place
// (`_content/`), a garden place with a plan card, and a writing place with a
// draft. Everything is committed.

import { execFileSync } from "node:child_process";
import { makeTmpBox, type TmpBox } from "../../helpers/test-helpers.js";
import { checkIntentions } from "../../../src/core/intention-review/check/core.js";
import { verifyIntentions } from "../../../src/core/intention-review/verify/core.js";

export const ROOT = "_content/Box.landmark.card";
export const GARDEN = "_content/garden/Garden.landmark.card";
export const WRITING = "_content/writing/Writing.landmark.card";
export const PLAN = "_content/garden/Plan.doc.card";
export const DRAFT = "_content/writing/Draft.doc.card";

export function landmark(label: string, extra: string): string {
  return `---\nnavigation:\n  label: ${label}\nkept-by: hand\n${extra}---\nWhere things stand in ${label}.\n`;
}

export async function placesBox(): Promise<TmpBox> {
  const box = await makeTmpBox({ git: true });
  await box.write(ROOT, landmark("Box", ""));
  await box.write(GARDEN, landmark("Garden", ""));
  await box.write(PLAN, '---\ntitle: Bean plan\n---\n{% todo id="water" %}Water the beans{% /todo %}\n');
  await box.write(WRITING, landmark("Writing", ""));
  await box.write(DRAFT, "---\ntitle: Garden post\n---\nThe trellis.\n");
  box.commitAll("places");
  return box;
}

/** Stage `paths` (all changes when none) and commit with `message`. */
export function commit(box: TmpBox, { message, paths }: { message: string; paths?: string[] }): void {
  execFileSync("git", ["add", "-A", "--", ...(paths ?? ["."])], { cwd: box.root, stdio: "pipe" });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: box.root, stdio: "pipe" });
}

export const PROCEDURE_MESSAGE = "Intentions: Garden\n\nGarden: the next step is the beans\n\nCreated-By: refresh-intentions";

/** Check, then verify with no edits: every listed place is recorded as reviewed. */
export async function reviewAll(box: TmpBox): Promise<void> {
  await checkIntentions(box.root);
  const result = await verifyIntentions(box.root);
  if (!result.ok) throw new Error(`review failed: ${result.problems.join("; ")}`);
}

export function head(box: TmpBox): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: box.root, encoding: "utf-8" }).trim();
}
