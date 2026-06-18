/**
 * Encode a canvas to the most efficient image format the browser can produce.
 *
 * Preference order: **AVIF → WebP → a caller-chosen fallback** (JPEG for
 * photos, PNG for graphics). AVIF and WebP are both far smaller than JPEG/PNG
 * at matching quality, AVIF the smaller — but `canvas.toBlob` AVIF *encoding*
 * support is narrower than WebP's, so we feature-detect once (cached for the
 * session) and cascade.
 *
 * `canvas.toBlob` silently substitutes PNG for an unsupported type rather than
 * failing, so detection — and every caller — must trust the produced blob's
 * `.type`, never the type we requested.
 */

const PREFERRED_TYPES = ["image/avif", "image/webp"] as const;

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
 * Encode `canvas` to AVIF/WebP when the browser supports it, else to
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
