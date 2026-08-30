/**
 * Encode a canvas to the most efficient image format the browser can produce.
 *
 * Preference order: **WebP → a caller-chosen fallback** (JPEG for photos, PNG
 * for graphics). WebP is far smaller than JPEG/PNG at matching quality, so we
 * feature-detect it once (cached for the session) and cascade to the fallback.
 *
 * AVIF is deliberately excluded even though it encodes smaller: every consumer
 * of this module (chat image paste, camera capture) sends the result to the
 * Anthropic Messages API, whose image blocks accept only jpeg/png/gif/webp
 * (`SUPPORTED_IMAGE_MEDIA_TYPES` in `services/claude-chat-content.ts`). An AVIF
 * attachment is rejected at the send boundary, so producing one is never useful
 * here — WebP is the smallest format the API also accepts.
 *
 * `canvas.toBlob` silently substitutes PNG for an unsupported type rather than
 * failing, so detection — and every caller — must trust the produced blob's
 * `.type`, never the type we requested.
 */

const PREFERRED_TYPES = ["image/webp"] as const;

// undefined = not yet probed; null = neither AVIF nor WebP can be encoded here.
let cachedType: string | null | undefined;

function canEncode(type: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;
    probe.toBlob((b) => resolve(b !== null && b.type === type), type, 0.8);
  });
}

async function preferredType(): Promise<string | null> {
  if (cachedType !== undefined) return cachedType;
  for (const type of PREFERRED_TYPES) {
    if (await canEncode(type)) {
      cachedType = type;
      return type;
    }
  }
  cachedType = null;
  return null;
}

export type FallbackImageType = "image/jpeg" | "image/png";

/**
 * Encode `canvas` to WebP when the browser supports it, else to
 * `fallback`. Resolves the encoded blob — whose `.type` is the format actually
 * produced — or null on encode failure. `quality` is ignored for PNG output.
 */
export async function encodeCanvasBlob(
  canvas: HTMLCanvasElement,
  { quality, fallback }: { quality: number; fallback: FallbackImageType },
): Promise<Blob | null> {
  const best = await preferredType();
  const type = best ?? fallback;
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), type, quality);
  });
}
