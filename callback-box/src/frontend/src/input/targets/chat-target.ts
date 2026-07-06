/**
 * ChatTarget — status + accept (docs/implemented-plans/input-extraction.md, chunk 3).
 * Wraps today's machine/backend state into `TargetStatus`, and turns a
 * dispatched Emission into a settled `Receipt` by pairing the receipt
 * registry (`targets/receipts.ts`) with the wire assembler
 * (`chat-assemble.ts`). Also holds the pure restore-planning logic used
 * when a receipt comes back `rejected` — the composer text/attachments were
 * cleared optimistically at dispatch, so a rejection needs to put the
 * emission back.
 *
 * Framework-free (input/ rule): no React, no DOM types. `acceptEmission`
 * takes `send` as an injected function (the chat machine's dispatch) rather
 * than importing the machine itself, so this module has no XState
 * dependency either.
 */

import type { ChatImageAttachment } from "../../api-chat";
import type { Emission, EmissionFile } from "../emission";
import type { SelectionItem } from "../../lib/selection/serialize";
import type { EmissionDraft, EmissionEditor, ImageItem, FileItem } from "../emission-store";
import type { ChatEvent } from "../../machines/chat-types";
import { assembleChatMessage, type ChatWitness } from "./chat-assemble";
import { expectReceipt, type Receipt } from "./receipts";

type SendEvent = Extract<ChatEvent, { type: "SEND" }>;
type CardFields = Pick<SendEvent, "openCard" | "cardActivity" | "cardState">;

/**
 * `ready`/`busy` map directly onto the chat machine's idle vs.
 * streaming/refreshing states; `disposition: "will-queue"` is the honest
 * value for `busy` — chat never interrupts a running turn on send, it
 * queues behind it. `unavailable` is part of the wider Target/status
 * vocabulary (docs/plans/input-widget.md) but chat has no session-gone
 * state that produces it today, so this adapter never returns it.
 */
export type ChatTargetStatus =
  | { state: "ready" }
  | { state: "busy"; disposition: "will-queue" };

/** Map machine + backend busy signals onto the target's status. */
export function chatTargetStatus(input: { isStreaming: boolean; processBusy: boolean }): ChatTargetStatus {
  if (input.isStreaming || input.processBusy) return { state: "busy", disposition: "will-queue" };
  return { state: "ready" };
}

/**
 * Assemble + dispatch an emission, returning a promise that settles with
 * the ACTUAL send outcome (never the pre-submit status snapshot — an
 * idle-path send can still resolve queued/deduplicated/rejected; see
 * chat-actors.ts). Registers the receipt expectation before `send()` so a
 * synchronous or near-synchronous settle can never race ahead of it.
 */
export function acceptEmission(
  emission: Emission,
  opts: {
    witness: ChatWitness;
    cardFields: CardFields;
    send: (event: ChatEvent) => void;
  },
): Promise<Receipt> {
  const { message, messageId, images } = assembleChatMessage(emission, opts.witness);
  const receipt = expectReceipt(messageId);
  if (images.length > 0) {
    opts.send({ type: "SEND", message, messageId, images: [...images], ...opts.cardFields });
  } else {
    opts.send({ type: "SEND", message, messageId, ...opts.cardFields });
  }
  return receipt;
}

/** What a rejected send restores into the composer, as a description (no store access). */
export interface RestorePlan {
  text: string;
  images: readonly ChatImageAttachment[];
  files: readonly EmissionFile[];
  selections: readonly SelectionItem[];
}

/**
 * Pure restore planning: an empty composer gets the rejected emission back
 * verbatim (its text already carries the `[imageN]`/`[fileN]`/`[selectionN]`
 * tokens, so nothing is re-inserted); a composer the user has since typed
 * into appends the failed text after a newline instead of clobbering it.
 * Attachments/selections are always re-added — they don't collide with
 * anything the user typed in the meantime.
 */
export function planRestore(draft: EmissionDraft, emission: Emission): RestorePlan {
  const text = draft.text.trim().length === 0 ? emission.text : `${draft.text}\n${emission.text}`;
  return { text, images: emission.images, files: emission.files, selections: emission.selections };
}

/** Rough byte-length estimate for a restored image (exactness doesn't matter — display only). */
function estimateByteLength(dataBase64: string): number {
  return Math.floor((dataBase64.length * 3) / 4);
}

/**
 * Basename of a `tmp/...` path, for the restored file's display name — the
 * Emission only carries the path (not the original filename/size/mimetype),
 * so a restored file attachment shows a degraded label. The path itself
 * stays valid (the upload already happened), so re-sending still works;
 * only the chip's display metadata is approximate.
 */
function pathBasename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Apply a restore plan through the emission editor. Not React, not DOM —
 * `objectUrl` for a restored image is a `data:` URI (no Blob/object-URL
 * APIs needed), which the editor's `reset()` will later hand back to a
 * caller expecting to `URL.revokeObjectURL` it; revoking a non-blob URL is
 * a documented no-op, not an error.
 */
export function applyRestorePlan(editor: EmissionEditor, plan: RestorePlan): void {
  // The send that just failed reset the id counters; the restored items keep
  // their original ids (they must — the text still carries the matching
  // tokens), so reserve those ids or the next added item could mint a
  // duplicate [image1]/[file1]/[selection1].
  editor.reserveIds({
    image: Math.max(0, ...plan.images.map((image) => image.id)),
    file: Math.max(0, ...plan.files.map((file) => file.id)),
    selection: Math.max(0, ...plan.selections.map((selection) => selection.id)),
  });
  editor.setText(plan.text);
  for (const image of plan.images) {
    const item: ImageItem = {
      id: image.id,
      mimeType: image.mimeType,
      dataBase64: image.dataBase64,
      objectUrl: `data:${image.mimeType};base64,${image.dataBase64}`,
      byteLength: estimateByteLength(image.dataBase64),
    };
    editor.addImage(item);
  }
  for (const file of plan.files) {
    const item: FileItem = {
      id: file.id,
      path: file.path,
      originalName: pathBasename(file.path),
      size: 0,
      mimetype: "application/octet-stream",
    };
    editor.addFile(item);
  }
  for (const selection of plan.selections) {
    editor.addSelection(selection);
  }
}
