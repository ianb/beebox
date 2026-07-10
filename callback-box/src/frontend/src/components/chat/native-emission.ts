import { createTypedEmission, createVoiceEmission, type Emission } from "../../input/emission";
import { isRecord } from "../../lib/is-record";
import type { ChatImageAttachment } from "../../api-chat";

export function nativeEmissionFromDetail(detail: unknown): Emission | null {
  if (!isRecord(detail)) return null;
  const candidate = detail;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const images = parseNativeImages(candidate.images);
  if (!text && images.length === 0) return null;
  const origin = candidate.origin === "voice" ? "voice" : "typed";
  if (origin === "voice") {
    return createVoiceEmission({
      text,
      images,
      selections: [],
      diarized: candidate.diarized === true,
    });
  }
  return createTypedEmission({
    text,
    images,
    files: [],
    selections: [],
  });
}

function parseNativeImages(value: unknown): ChatImageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const image = item;
    if (typeof image.id !== "number" || typeof image.mimeType !== "string" || typeof image.dataBase64 !== "string") {
      return [];
    }
    return [{ id: image.id, mimeType: image.mimeType, dataBase64: image.dataBase64 }];
  });
}
