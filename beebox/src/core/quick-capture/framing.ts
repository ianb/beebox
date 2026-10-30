/** The wrapper contains human words only. Material is referenced, never interpolated. */
import type { QuickChatSource } from "../chat/routing/quick-chat-record.js";
import { escapeXmlAttr } from "../../shared/self-note.js";

export function frameExternalCapture(args: { message: string; source?: QuickChatSource | undefined; sourceRef?: string | undefined; retainedRecording?: boolean | undefined; recordingInterrupted?: boolean | undefined; captureInputKind?: "words" | "transcript" | undefined }): string {
  const source = args.source === undefined ? "" : ` source="${args.source}"`;
  const ref = args.sourceRef === undefined ? "" : ` source-ref="${escapeXmlAttr(args.sourceRef)}"`;
  const recording = args.retainedRecording === true ? ' retained-recording="1"' : "";
  const interrupted = args.recordingInterrupted === true ? ' recording-interrupted="1"' : "";
  const kind = args.captureInputKind === undefined ? "" : ` input-kind="${args.captureInputKind}"`;
  return `<external-input${source}${ref}${recording}${interrupted}${kind}>${args.message}</external-input>`;
}
