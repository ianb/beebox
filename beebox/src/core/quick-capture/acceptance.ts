/** Seal a complete capture without requiring chat, transcription, or a model. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getBoxTimeISO } from "../../lib/time.js";
import { quickCaptureDeclarationSchema, type QuickCaptureDeclaration } from "../../shared/quick-capture.js";
import { reconcileCaptureSourceLocked } from "./source.js";
import { captureDigest, captureDirectory, readCapture, requireCaptureOwner, withCaptureLock, writeCapture, QuickCaptureError } from "./store.js";

export interface CaptureBytes { path: string; size: number; sha256: string }
export async function acceptQuickCapture(args: {
  boxRoot: string; id: string; owner: string | null;
  declaration: QuickCaptureDeclaration; bytes?: CaptureBytes;
}): Promise<{ id: string; state: "accepted" }> {
  const { boxRoot, id, owner } = args;
  const declaration = quickCaptureDeclarationSchema.parse(args.declaration);
  if (declaration.parentCaptureId === id) throw new QuickCaptureError({ reason: "self-context" });
  const material = declaration.material;
  const file = material?.kind === "image" || material?.kind === "audio" ? material : undefined;
  if (file !== undefined) {
    if (args.bytes === undefined || args.bytes.size !== file.byteLength || args.bytes.sha256 !== file.sha256) throw new QuickCaptureError({ reason: "incomplete-material" });
  } else if (args.bytes !== undefined) throw new QuickCaptureError({ reason: "undeclared-file" });
  const digest = captureDigest(declaration);
  return withCaptureLock({ boxRoot, id }, async () => {
    const previous = await readCapture(boxRoot, id);
    if (previous !== null) {
      requireCaptureOwner(previous, owner);
      await reconcileCaptureSourceLocked(boxRoot, previous);
      if (previous.state === "gone") throw new QuickCaptureError({ reason: "deleted-capture" });
      if (previous.digest !== digest) throw new QuickCaptureError({ reason: "changed-content" });
      return { id, state: "accepted" };
    }
    if (declaration.parentCaptureId !== undefined) {
      const parent = await readCapture(boxRoot, declaration.parentCaptureId);
      if (parent === null) throw new QuickCaptureError({ reason: "missing-parent" });
      requireCaptureOwner(parent, owner);
      if (parent.declaration.parentCaptureId !== undefined) throw new QuickCaptureError({ reason: "nested-context" });
      if (parent.state === "gone") throw new QuickCaptureError({ reason: "deleted-parent" });
    }
    const dir = captureDirectory(boxRoot, id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const parentDirectory = await fs.open(path.dirname(dir), "r");
    try { await parentDirectory.sync(); } finally { await parentDirectory.close(); }
    if (args.bytes !== undefined) {
      await fs.rename(args.bytes.path, path.join(dir, "material"));
      const handle = await fs.open(dir, "r");
      try { await handle.sync(); } finally { await handle.close(); }
    }
    await writeCapture(boxRoot, { id, owner, digest, declaration, acceptedAt: getBoxTimeISO(boxRoot), state: "accepted", attempts: 0 });
    return { id, state: "accepted" };
  });
}
