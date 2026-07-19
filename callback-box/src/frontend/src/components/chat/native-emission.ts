import { createTypedEmission, createVoiceEmission, type Emission } from "../../input/emission";
// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW.
import { isRecord } from "../../../../shared/is-record.js";
import type { ChatImageAttachment } from "../../api-chat";

export function nativeEmissionFromDetail(detail: unknown): Emission | null {
  if (!isRecord(detail)) return null;
  const candidate = detail;
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const images = parseNativeImages(candidate.images);
  if (!text && images.length === 0) return null;
  const origin = candidate.origin === "voice" ? "voice" : "typed";
  if (origin === "voice") {
    const emission = createVoiceEmission({
      text,
      images,
      selections: [],
      diarized: candidate.diarized === true,
    });
    return withNativeId(emission, candidate.id);
  }
  const emission = createTypedEmission({
    text,
    images,
    files: [],
    selections: [],
  });
  return withNativeId(emission, candidate.id);
}

function withNativeId(emission: Emission, value: unknown): Emission {
  if (typeof value !== "string" || value.trim() === "") return emission;
  return { ...emission, id: value };
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
