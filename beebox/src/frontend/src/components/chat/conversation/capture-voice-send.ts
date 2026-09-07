import type { EmissionDispatch } from "./use-bound-emission";
import type { EmissionDraft } from "../../../input/emission-store";
import { checkedDraftAttachments } from "./typed-submit";

/** Refusal before materialization must put the utterance back and settle the mic. */
export async function captureVoiceSend(opts: {
  capture: () => EmissionDispatch;
  awaitUploads: () => Promise<void>;
  readDraft: () => EmissionDraft;
  preserve: () => void;
  refused: (error: unknown) => void;
}) {
  let dispatch: EmissionDispatch | undefined;
  try {
    dispatch = opts.capture();
    await opts.awaitUploads();
    const draft = opts.readDraft();
    return { dispatch, draft, attachments: checkedDraftAttachments(draft) };
  } catch (error) {
    dispatch?.release();
    opts.preserve();
    opts.refused(error);
    return null;
  }
}
