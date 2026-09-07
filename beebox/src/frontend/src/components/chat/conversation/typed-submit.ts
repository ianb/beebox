import { createTypedEmission, draftAttachments } from "../../../input/emission";
import type { EmissionStore, EmissionDraft } from "../../../input/emission-store";
import type { EmissionDispatch } from "./use-bound-emission";
import type { Receipt } from "../../../input/targets/receipts";

export class UnfinishedChatUploadError extends Error {
  constructor(names: string[]) {
    super(`Not sent — ${names.join(", ")} did not upload. Retry or remove the attachment, then send.`);
    this.name = "UnfinishedChatUploadError";
  }
}

export function checkedDraftAttachments(draft: EmissionDraft) {
  const failed = draft.files.filter((file) => file.state.status === "failed");
  if (failed.length > 0) throw new UnfinishedChatUploadError(failed.map((file) => file.originalName));
  if (draft.pendingImages > 0) throw new UnfinishedChatUploadError(["Image still being prepared"]);
  return draftAttachments(draft);
}

/** Capture the recipient before upload waits; preserve the draft on refusal. */
export async function submitTypedDraft(opts: {
  emissionStore: EmissionStore;
  capture: () => EmissionDispatch;
  awaitUploads: () => Promise<void>;
  onCommitted: () => void;
  onReceipt: (receipt: Promise<Receipt>) => void;
}): Promise<boolean> {
  const dispatch = opts.capture();
  let submitted = false;
  try {
    await opts.awaitUploads();
    const draft = opts.emissionStore.get();
    const attachments = checkedDraftAttachments(draft);
    if (!draft.text.trim() && draft.images.length === 0 && draft.files.length === 0 && draft.selections.length === 0) return false;
    const emission = createTypedEmission({ text: draft.text.trim(), ...attachments, selections: draft.selections });
    // The call stages synchronously and may throw. No draft is cleared first.
    const receipt = dispatch(emission);
    submitted = true;
    opts.onCommitted();
    opts.onReceipt(receipt);
    return true;
  } finally {
    if (!submitted) dispatch.release();
  }
}
