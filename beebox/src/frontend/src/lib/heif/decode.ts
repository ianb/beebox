/**
 * Decode a HEIF/HEIC blob in a short-lived Web Worker and return it as an
 * upright `ImageBitmap` the canvas can draw.
 *
 * `image-paste.ts` calls it only after the browser's own decoder has refused
 * a file whose header is HEIF (`sniff.ts`). The worker and its WebAssembly
 * load then, not with the page: Safari decodes HEIC natively and never loads
 * them; Chrome and Firefox load them on the first HEIC they meet.
 */

import type { HeifWorkerReply, HeifWorkerRequest } from "./protocol";

/** The decoder did not start: the worker script or its `.wasm` failed to load. */
export class HeifDecoderUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "HeifDecoderUnavailableError";
  }
}

/** The decoder ran and could not read the file. */
export class HeifUnreadableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "HeifUnreadableError";
  }
}

const HEIF_UNAVAILABLE = "HEIF decoder worker failed to start";
const HEIF_REPLY_UNREADABLE = "HEIF decoder worker reply could not be read";

/** A `Worker` constructor that throws (no Worker API, a `SecurityError`) means the decoder is unavailable, not that the photo is bad. */
function startWorker(): Worker {
  try {
    return new Worker(new URL("./decoder/worker.ts", import.meta.url), { type: "module" });
  } catch (e) {
    throw new HeifDecoderUnavailableError(e instanceof Error ? e.message : HEIF_UNAVAILABLE);
  }
}

export async function decodeHeifToBitmap(blob: Blob): Promise<ImageBitmap> {
  const bytes = await blob.arrayBuffer();
  const worker = startWorker();
  try {
    const reply = await new Promise<HeifWorkerReply>((resolve, reject) => {
      worker.addEventListener("message", (event: MessageEvent<HeifWorkerReply>) => resolve(event.data));
      // `error` fires when the worker script itself fails to load or throws at
      // top level, for example a chunk that a newer deploy removed.
      worker.addEventListener("error", (event) => {
        reject(new HeifDecoderUnavailableError(event.message === "" ? HEIF_UNAVAILABLE : event.message));
      });
      // The reply could not be deserialized; nothing else will arrive.
      worker.addEventListener("messageerror", () => reject(new HeifDecoderUnavailableError(HEIF_REPLY_UNREADABLE)));
      const request: HeifWorkerRequest = { bytes };
      worker.postMessage(request, [bytes]);
    });
    if (!reply.ok) {
      throw reply.stage === "load" ? new HeifDecoderUnavailableError(reply.error) : new HeifUnreadableError(reply.error);
    }
    return await createImageBitmap(new ImageData(reply.pixels, reply.width, reply.height));
  } finally {
    worker.terminate();
  }
}

