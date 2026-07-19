/**
 * Chat-target assembly — the ONE place an Emission becomes a chat wire
 * payload (docs/implemented-plans/input-extraction.md, chunk 1). Replaces the five
 * scattered payload builders (typed handleSend, keyword-voice submit, the
 * desktop/mobile stop-and-send buttons, recovered dictation), whose exact
 * output strings are pinned by test/frontend/emission-assemble.doctest.md.
 *
 * Assembly lives with the target, not the input (design decision recorded
 * in docs/plans/input-widget.md): the `<typed>`/`<speech>` wrapper rules
 * are ChatTarget's business; the input ships the emission noun. The
 * witness context (what the user was looking at when they sent) is also
 * the target adapter's concern — it arrives here as plain serializable
 * values, never as functions or React state.
 */

import type { ChatImageAttachment } from "../../api-chat";
import { applySelections } from "../../lib/selection/serialize";
import type { Emission } from "../emission";

/**
 * Frame state at the moment of sending, pre-formatted as plain values:
 * `localTime` is "HH:MM"; `zoomedView` is the serialized `view:` URI of
 * the zoomed companion view or null; `timePassed` is the "3h"/"2d4h"
 * gap-since-last-message string or null (callers omit it under 6h,
 * per formatTimePassed).
 */
export interface ChatWitness {
  localTime: string;
  zoomedView: string | null;
  timePassed: string | null;
}

/** The wire payload for a SEND: the wrapped message + image attachments. */
export interface AssembledChatMessage {
  messageId: string;
  message: string;
  images: readonly ChatImageAttachment[];
}

function witnessAttrs(witness: ChatWitness): string {
  return (
    ` local-time="${witness.localTime}"` +
    (witness.zoomedView !== null ? ` zoomed-view="${witness.zoomedView}"` : "") +
    (witness.timePassed !== null ? ` time-passed="${witness.timePassed}"` : "")
  );
}

/**
 * Assemble an emission into today's exact wire format. Attribute order,
 * the `<attachments>` reference-link block, and selection folding all
 * reproduce the historical per-site builders byte-for-byte — including
 * the stop-and-send paths' behavior, which arrive with empty selections
 * (applySelections with no selections is the identity).
 */
export function assembleChatMessage(
  emission: Emission,
  witness: ChatWitness,
): AssembledChatMessage {
  const attrs = witnessAttrs(witness);
  // `[fileN]` tokens are placemarkers the user can position in the text. A
  // file whose token is missing (voice sends never had one; a typed send's
  // may have been edited out) is noted at the end of the text instead, so
  // the <attachments> block below never lists an unreferenced file.
  const missingTokens = emission.files
    .map((f) => `[file${f.id}]`)
    .filter((token) => !emission.text.includes(token));
  const text = missingTokens.length === 0
    ? emission.text
    : [emission.text, ...missingTokens].filter((s) => s.length > 0).join(" ");
  const body = applySelections(text, {
    selections: [...emission.selections],
  });

  // Trust note (Track I): the outer <typed>/<speech> body is deliberately NOT
  // escaped/fenced. It is first-party owner input (the trust root, not an
  // injection vector), and — critically — `applySelections` inserts
  // `<user-selection>` child elements into it that the agent and the display
  // layer both parse as structure; uniformly escaping the body would launder
  // those intended tags. The masquerade boundary lives one level down, in
  // selection-serialize's escapeText/escapeAttr on each selection's own
  // text/attrs. Fencing here is reserved for untrusted content (card/job/
  // external bytes), which enters prompts through fenceForPrompt, not this path.
  let wrapped: string;
  if (emission.origin === "typed") {
    wrapped = `<typed${attrs}>${body}</typed>`;
  } else {
    const diarizedAttr = emission.diarized ? " diarized=\"1\"" : "";
    wrapped = `<speech${diarizedAttr}${attrs}>${body}</speech>`;
  }

  // File attachments emit a sibling <attachments> block of markdown-style
  // reference links so the agent sees the path each [fileN] token resolves
  // to without inlining the file's bytes.
  const attachmentsBlock = emission.files.length > 0
    ? "\n<attachments>\n" +
      emission.files.map((f) => `[file${f.id}]: ${f.path}`).join("\n") +
      "\n</attachments>"
    : "";

  return {
    messageId: emission.id,
    message: wrapped + attachmentsBlock,
    images: emission.images,
  };
}
