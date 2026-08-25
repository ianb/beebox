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
import { markUnsureWords } from "../unsure-words";
import { composerToken, composerTokenIn } from "@shared/composer-tokens";

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
  // Each file's token AS THE BODY SPELLS IT — a body restored from a draft
  // written before the `#` rename still says `[file1]`, and the <attachments>
  // block below has to label it the same way or the two halves of one message
  // disagree. A file the body never mentions gets the current form, appended.
  const fileTokens = emission.files.map((f) => ({
    file: f,
    token: composerTokenIn(emission.text, { kind: "file", id: f.id }),
  }));
  const missingTokens = fileTokens.filter((e) => e.token === null).map((e) => composerToken("file", e.file.id));
  const text = missingTokens.length === 0
    ? emission.text
    : [emission.text, ...missingTokens].filter((s) => s.length > 0).join(" ");
  // <unsure> marking (Track 3, docs/plans/transcript-confidence.md) runs on
  // `text` — before selections fold in — so the words-stream alignment never
  // has to reason about `<user-selection>` markup, and never risks landing a
  // wrap partway through one. Selection anchor-matching (below) still works
  // against the marked text; a spoken anchor phrase that happens to include a
  // marked word is a narrow, accepted trade for keeping the marker placement
  // itself simple and never XML-corrupting.
  const markedText = emission.origin === "voice" && emission.words !== undefined
    ? markUnsureWords(text, { words: emission.words, spokenStart: emission.spokenStart ?? 0 })
    : text;
  const body = applySelections(markedText, {
    selections: [...emission.selections],
  });

  // Trust note (Track I): the outer <typed>/<speech> body is deliberately NOT
  // escaped/fenced. It is first-party owner input (the trust root, not an
  // injection vector), and — critically — `applySelections` inserts
  // `<user-selection>` child elements into it that the agent and the display
  // layer both parse as structure, and the body may now carry `<unsure>`
  // marks (Track 3) the same way; uniformly escaping the body would launder
  // those intended tags. The masquerade boundary lives one level down, in
  // selection-serialize's escapeText/escapeAttr on each selection's own
  // text/attrs. Fencing here is reserved for untrusted content (card/job/
  // external bytes), which enters prompts through fenceForPrompt, not this path.
  let wrapped: string;
  if (emission.origin === "typed") {
    wrapped = `<typed${attrs}>${body}</typed>`;
  } else {
    const diarizedAttr = emission.diarized ? " diarized=\"1\"" : "";
    // `stt` is stamped when the message carries transcription provenance —
    // either captured word-confidence data (`deepgram`) or an HQ pass that
    // replaced the realtime text (`hq`, docs/implemented-plans/hq-dictation-switch.md).
    // The two are mutually exclusive: an HQ pass always drops the realtime
    // words it replaced (the pre-existing HQ-drop rule), so `emission.words`
    // is never defined on an `hqText` emission. Absence of `stt` means no
    // provenance data backs this message at all — distinct from "captured,
    // none unsure" (`deepgram` with no `<unsure>` marks).
    const sttAttr = emission.hqText === true
      ? " stt=\"hq\""
      : emission.words !== undefined ? " stt=\"deepgram\"" : "";
    // `message-id` (retranscription-in-chat plan, Vocabulary lock-ins) is the
    // emission id — the same value returned as `messageId` below and the key
    // the audio retention store uses — stamped on every voice send so the
    // message stays addressable after the pending→authoritative uuid swap.
    // Typed sends carry no recording to point back at, so they don't get it.
    const messageIdAttr = ` message-id="${emission.id}"`;
    wrapped = `<speech${sttAttr}${diarizedAttr}${messageIdAttr}${attrs}>${body}</speech>`;
  }

  // File attachments emit a sibling <attachments> block of markdown-style
  // reference links so the agent sees the path each [fileN] token resolves
  // to without inlining the file's bytes.
  const attachmentsBlock = emission.files.length > 0
    ? "\n<attachments>\n" +
      fileTokens.map((e) => `${e.token ?? composerToken("file", e.file.id)}: ${e.file.path}`).join("\n") +
      "\n</attachments>"
    : "";

  return {
    messageId: emission.id,
    message: wrapped + attachmentsBlock,
    images: emission.images,
  };
}
