/** Versioned box-level capture contract; material never becomes authored input. */
import { z } from "zod";

export const QUICK_CAPTURE_SOURCES = ["apple-app-intents", "apple-share-extension", "apple-voice-recording", "apple-native-input"] as const;
export const QUICK_CAPTURE_MAX_FILE_BYTES = 50 * 1024 * 1024;
const QUICK_CAPTURE_MAX_INPUT_CHARACTERS = 10000;
const QUICK_CAPTURE_MAX_CLIPPING_CHARACTERS = 100000;
// JSON can use six bytes per UTF-16 unit; allow maximum clipping + words + metadata.
export const QUICK_CAPTURE_MAX_DECLARATION_BYTES = 6 * (QUICK_CAPTURE_MAX_INPUT_CHARACTERS + QUICK_CAPTURE_MAX_CLIPPING_CHARACTERS) + 8192;
const title = z.string().max(500).optional();
const fileShape = {
  id: z.string().uuid().transform(value => value.toLowerCase()), mimeType: z.string().max(100),
  byteLength: z.number().int().positive().max(QUICK_CAPTURE_MAX_FILE_BYTES),
  sha256: z.string().regex(/^[\da-f]{64}$/),
  fileName: z.string().min(1).max(200).refine(value => [...value].every(character => (character.codePointAt(0) ?? 0) >= 32 && character !== "/" && character !== "\\")).refine(value => value !== "." && value !== ".."),
};
export const quickCaptureMaterialSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string().url().max(10000).refine(value => /^https?:\/\//i.test(value)), title }).strict(),
  z.object({ kind: z.literal("clipping"), text: z.string().min(1).max(QUICK_CAPTURE_MAX_CLIPPING_CHARACTERS), title }).strict(),
  z.object({ kind: z.literal("image"), ...fileShape, mimeType: z.enum(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]) }).strict(),
  z.object({ kind: z.literal("audio"), ...fileShape, mimeType: z.enum(["audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/webm", "audio/mpeg"]) }).strict(),
]);
export const quickCaptureDeclarationFieldsSchema = z.object({
  version: z.literal(1), capturedAt: z.string().max(50).datetime({ offset: true }),
  source: z.enum(QUICK_CAPTURE_SOURCES),
  input: z.string().max(QUICK_CAPTURE_MAX_INPUT_CHARACTERS).optional(),
  recordingInterrupted: z.literal(true).optional(),
  material: quickCaptureMaterialSchema.optional(), parentCaptureId: z.string().uuid().transform(value => value.toLowerCase()).optional(),
}).strict();
export const quickCaptureDeclarationSchema = quickCaptureDeclarationFieldsSchema.superRefine((value, ctx) => {
  if ((value.input === undefined || value.input.trim() === "") && value.material === undefined) ctx.addIssue({ code: "custom", message: "A capture needs words or material." });
  if (value.recordingInterrupted === true && value.material?.kind !== "audio") ctx.addIssue({ code: "custom", message: "Interrupted recording metadata requires audio material." });
  if (value.parentCaptureId !== undefined && value.material !== undefined) ctx.addIssue({ code: "custom", message: "Context accepts words only in version 1." });
});
export type QuickCaptureDeclaration = z.infer<typeof quickCaptureDeclarationSchema>;
export type QuickCaptureMaterial = z.infer<typeof quickCaptureMaterialSchema>;
export const quickCaptureReceiptSchema = z.object({ id: z.string().uuid().transform(value => value.toLowerCase()), state: z.literal("accepted") });
export const quickCaptureCapabilities = {
  version: 1, maxFileBytes: QUICK_CAPTURE_MAX_FILE_BYTES,
  maxInputCharacters: QUICK_CAPTURE_MAX_INPUT_CHARACTERS,
  maxClippingCharacters: QUICK_CAPTURE_MAX_CLIPPING_CHARACTERS,
  materialKinds: ["url", "clipping", "image", "audio"],
} as const;
export const QUICK_CAPTURE_STATES = ["accepted", "preparing", "saved", "needs-choice", "sending", "sent", "failed", "blocked", "gone"] as const;
