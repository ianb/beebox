/** Messages between `decode.ts` (the page) and `decoder/worker.ts`. One request, one reply, per worker. */

export interface HeifWorkerRequest {
  /** The whole file; transferred, so the page's copy is detached. */
  bytes: ArrayBuffer;
}

export type HeifWorkerReply =
  | { ok: true; width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> }
  /** `load`: libheif or its `.wasm` failed to start. `decode`: libheif ran and could not read the file. */
  | { ok: false; stage: "load" | "decode"; error: string };
