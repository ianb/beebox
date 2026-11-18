/**
 * Decode a HEIF/HEIC file's primary image to upright RGBA pixels with
 * libheif-js (an Emscripten build of libheif). Kept free of DOM and worker
 * APIs so a Node test can run it against real files; `decoder/worker.ts` is the
 * browser shell around it.
 *
 * Orientation: libheif applies the file's `irot`/`imir` transforms while
 * decoding (its decoding options default to `ignore_transformations = 0`), so
 * the pixels come out upright. That is the same contract as the native path in
 * `image-paste.ts` (`imageOrientation: "from-image"`).
 */

/**
 * `shared/is-record.ts` by another route: the Node test runner cannot resolve
 * the `@shared` alias, and lint rejects the raw relative path from app code.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One image, as libheif-js's hand-written `HeifImage` wrapper exposes it. */
interface HeifImageHandle {
  /** The raw libheif handle, passed to `heif_js_decode_image2`. */
  handle: unknown;
  get_width(): number;
  get_height(): number;
  is_primary(): boolean;
  free(): void;
}

interface HeifDecoderInstance {
  /** The libheif context `decode` allocated; freed with `heif_context_free`. */
  decoder: unknown;
  decode(bytes: Uint8Array): HeifImageHandle[];
}

/** The slice of the libheif-js module this file uses. Its bundled `.d.ts` covers only the raw embind API. */
export interface LibheifModule {
  HeifDecoder: new () => HeifDecoderInstance;
  heif_context_free(context: unknown): void;
  /** Returns the decoded image, or an error object with a `code` (embind `any`). */
  heif_js_decode_image2(handle: unknown, colorspace: unknown, chroma: unknown): unknown;
  heif_image_release(image: unknown): void;
  heif_colorspace: { heif_colorspace_RGB: unknown };
  heif_chroma: { heif_chroma_interleaved_RGBA: unknown };
  heif_channel: { heif_channel_interleaved: unknown };
}

/** libheif-js's Emscripten factory: it returns the module at once and initializes it in the background. */
type LibheifFactory = (options: { locateFile?: () => string; onRuntimeInitialized: () => void; onAbort: (what: unknown) => void }) => unknown;

/**
 * Instantiate libheif and wait until its WebAssembly is running. The factory
 * returns the module before the `.wasm` is fetched and compiled, so calling it
 * then would fail; `onAbort` reports a fetch or compile failure.
 */
export async function loadLibheif(factory: LibheifFactory, { wasmUrl }: { wasmUrl?: string }): Promise<LibheifModule> {
  // The executor runs synchronously, so both callbacks are set before the
  // factory can call them (in Node it initializes during the call itself).
  const settle: { ready?: () => void; fail?: (what: unknown) => void } = {};
  const initialized = new Promise<void>((resolve, reject) => {
    settle.ready = resolve;
    settle.fail = (what) => reject(new LibheifStartError(what));
  });
  const mod = factory({
    ...(wasmUrl === undefined ? {} : { locateFile: () => wasmUrl }),
    onRuntimeInitialized: () => settle.ready?.(),
    onAbort: (what) => settle.fail?.(what),
  });
  await initialized;
  return asLibheifModule(mod);
}

/** Narrow the factory's result at the boundary; a library update that renames these fails here, by name. */
function asLibheifModule(mod: unknown): LibheifModule {
  if (isLibheifModule(mod)) return mod;
  throw new HeifDecodeError(HEIF_ERR.module);
}

function isLibheifModule(mod: unknown): mod is LibheifModule {
  return isRecord(mod) &&
    typeof mod.HeifDecoder === "function" &&
    typeof mod.heif_context_free === "function" &&
    typeof mod.heif_js_decode_image2 === "function" &&
    typeof mod.heif_image_release === "function" &&
    // Embind enums are constructor functions carrying their values as properties.
    typeof mod.heif_colorspace === "function" && typeof mod.heif_chroma === "function" && typeof mod.heif_channel === "function";
}

/** One plane of a decoded image (`heif_js_decode_image2`'s `channels`). */
interface DecodedChannel {
  id: unknown;
  data: Uint8Array;
  stride: number;
}

interface DecodedImage {
  image: unknown;
  channels: DecodedChannel[];
}

function isDecodedImage(value: unknown): value is DecodedImage {
  return isRecord(value) && value.code === undefined && Array.isArray(value.channels) &&
    value.channels.every((c) => isRecord(c) && c.data instanceof Uint8Array && typeof c.stride === "number");
}

/** libheif's WebAssembly failed to fetch, compile, or start; `what` is Emscripten's abort reason. */
class LibheifStartError extends Error {
  constructor(what: unknown) {
    super(String(what));
    this.name = "LibheifStartError";
  }
}

class HeifDecodeError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "HeifDecodeError";
  }
}

const HEIF_ERR = {
  module: "libheif module lacks the decode API this file uses",
  noRgba: "libheif returned no interleaved RGBA channel",
  noImage: "No image in HEIF file",
  decode: "libheif could not decode the image",
} as const;

export interface DecodedPixels {
  width: number;
  height: number;
  /** RGBA, row-major, `width * height * 4` bytes. */
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Decode `bytes`' primary image (the first top-level image when none is marked primary).
 *
 * This calls libheif's decode directly rather than through the wrapper's
 * `display(target, callback)`: `display` runs the decode inside a detached
 * `setTimeout(async …)`, so a WebAssembly trap there is an unhandled rejection
 * and the callback never fires. Called here, the trap throws to our caller.
 */
export function decodeHeifPrimary(libheif: LibheifModule, bytes: Uint8Array): DecodedPixels {
  const decoder = new libheif.HeifDecoder();
  // `decode` logs and returns [] on a parse failure rather than throwing.
  const images = decoder.decode(bytes);
  try {
    const image = images.find((candidate) => candidate.is_primary()) ?? images[0];
    if (image === undefined) throw new HeifDecodeError(HEIF_ERR.noImage);
    const width = image.get_width();
    const height = image.get_height();
    return { width, height, pixels: decodeRgba(libheif, { image, width, height }) };
  } finally {
    for (const image of images) image.free();
    if (decoder.decoder !== null) libheif.heif_context_free(decoder.decoder);
  }
}

/** Decode one image to tightly packed RGBA, copying row by row when libheif pads its rows. */
function decodeRgba(libheif: LibheifModule, { image, width, height }: { image: HeifImageHandle; width: number; height: number }): Uint8ClampedArray<ArrayBuffer> {
  const decoded = libheif.heif_js_decode_image2(image.handle, libheif.heif_colorspace.heif_colorspace_RGB, libheif.heif_chroma.heif_chroma_interleaved_RGBA);
  if (!isDecodedImage(decoded)) throw new HeifDecodeError(HEIF_ERR.decode);
  try {
    const channel = decoded.channels.find((c) => c.id === libheif.heif_channel.heif_channel_interleaved);
    if (channel === undefined) throw new HeifDecodeError(HEIF_ERR.noRgba);
    const rowBytes = width * 4;
    const pixels = new Uint8ClampedArray(new ArrayBuffer(rowBytes * height));
    if (channel.stride === rowBytes) {
      pixels.set(channel.data.subarray(0, rowBytes * height));
    } else {
      for (let row = 0; row < height; row++) {
        pixels.set(channel.data.subarray(row * channel.stride, row * channel.stride + rowBytes), row * rowBytes);
      }
    }
    return pixels;
  } finally {
    libheif.heif_image_release(decoded.image);
  }
}
