import {
  createTypedEmission,
  createVoiceEmission,
  type Emission,
  type EmissionFile,
} from "../../input/emission";
// Raw relative (not `@shared/…`): loaded outside Vite by the tap/tsx doctest
// runner (root tsconfig, no @shared resolution) — see OUTSIDE_VITE_SHARED_RAW.
import { isRecord } from "../../../../shared/is-record.js";
import type { ChatImageAttachment } from "../../api-chat";
import type { SelectionItem } from "../../lib/selection/serialize";

export interface NativeEmissionV2 {
  version: 2;
  id: string;
  origin: "typed" | "voice";
  text: string;
  diarized: boolean;
  images: ChatImageAttachment[];
  files: Array<Required<EmissionFile>>;
  selections: Array<Required<Pick<SelectionItem, "id" | "ref" | "text" | "position" | "anchor" | "spokenWords">>>;
}

export type NativeEmissionParseResult =
  | { ok: true; emission: Emission }
  | { ok: false; emissionId: string | null; reason: string };

export function nativeEmissionFromDetail(detail: unknown): Emission | null {
  const result = parseNativeEmissionDetail(detail);
  return result.ok ? result.emission : null;
}

export function parseNativeEmissionDetail(detail: unknown): NativeEmissionParseResult {
  if (!isRecord(detail)) {
    return { ok: false, emissionId: null, reason: "Invalid native message" };
  }
  if ("version" in detail) {
    if (detail.version !== 2) {
      return reject(detail, `Unsupported native emission version: ${String(detail.version)}`);
    }
    return parseV2(detail);
  }
  const emission = parseLegacy(detail);
  return emission === null
    ? reject(detail, "Invalid native message")
    : { ok: true, emission };
}

function parseV2(candidate: Record<string, unknown>): NativeEmissionParseResult {
  const id = nonEmptyString(candidate.id);
  if (id === null) return reject(candidate, "Invalid native emission V2: id must be a non-empty string");
  if (candidate.origin !== "typed" && candidate.origin !== "voice") {
    return reject(candidate, "Invalid native emission V2: origin must be typed or voice");
  }
  if (typeof candidate.text !== "string" || typeof candidate.diarized !== "boolean") {
    return reject(candidate, "Invalid native emission V2: text and diarized are required");
  }
  const images = parseV2Array(candidate.images, parseNativeImage);
  const files = parseV2Array(candidate.files, parseNativeFile);
  const selections = parseV2Array(candidate.selections, parseNativeSelection);
  if (images === null || files === null || selections === null) {
    return reject(candidate, "Invalid native emission V2: malformed image, file, or selection");
  }
  const text = candidate.text.trim();
  if (text === "" && images.length === 0 && files.length === 0 && selections.length === 0) {
    return reject(candidate, "Invalid native emission V2: message has no content");
  }
  const common = { text, images, files, selections };
  const emission = candidate.origin === "voice"
    ? createVoiceEmission({ ...common, diarized: candidate.diarized })
    : createTypedEmission(common);
  return { ok: true, emission: { ...emission, id } };
}

function parseLegacy(candidate: Record<string, unknown>): Emission | null {
  const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
  const images = parseLegacyNativeImages(candidate.images);
  if (!text && images.length === 0) return null;
  const origin = candidate.origin === "voice" ? "voice" : "typed";
  if (origin === "voice") {
    const emission = createVoiceEmission({
      text,
      images,
      files: [],
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

function reject(candidate: Record<string, unknown>, reason: string): NativeEmissionParseResult {
  return { ok: false, emissionId: nonEmptyString(candidate.id), reason };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function withNativeId(emission: Emission, value: unknown): Emission {
  if (typeof value !== "string" || value.trim() === "") return emission;
  return { ...emission, id: value };
}

function parseLegacyNativeImages(value: unknown): ChatImageAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => parseNativeImage(item) ?? []);
}

function parseV2Array<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  for (const item of value) {
    const result = parse(item);
    if (result === null) return null;
    parsed.push(result);
  }
  return parsed;
}

function parseNativeImage(value: unknown): ChatImageAttachment | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number"
    || typeof value.mimeType !== "string"
    || typeof value.dataBase64 !== "string"
  ) {
    return null;
  }
  return { id: value.id, mimeType: value.mimeType, dataBase64: value.dataBase64 };
}

function parseNativeFile(value: unknown): Required<EmissionFile> | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number"
    || typeof value.path !== "string"
    || typeof value.originalName !== "string"
    || typeof value.size !== "number"
    || !Number.isFinite(value.size)
    || value.size < 0
    || typeof value.mimetype !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    path: value.path,
    originalName: value.originalName,
    size: value.size,
    mimetype: value.mimetype,
  };
}

function parseNativeSelection(value: unknown): NativeEmissionV2["selections"][number] | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "number"
    || typeof value.ref !== "string"
    || typeof value.text !== "string"
    || typeof value.position !== "string"
    || (value.anchor !== null && typeof value.anchor !== "string")
    || (value.spokenWords !== null && typeof value.spokenWords !== "number")
  ) {
    return null;
  }
  return {
    id: value.id,
    ref: value.ref,
    text: value.text,
    position: value.position,
    anchor: value.anchor,
    spokenWords: value.spokenWords,
  };
}
