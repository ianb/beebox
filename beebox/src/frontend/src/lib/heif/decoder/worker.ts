/**
 * Web Worker that decodes one HEIF/HEIC file to RGBA (see `libheif.ts`).
 *
 * It runs off the page for two reasons. A large photo takes seconds to decode
 * (about 2.3 s for 36 megapixels on an M-series Mac), which would freeze the
 * composer. And WebAssembly memory never shrinks: one decode grows libheif's
 * heap to hold the full image, so the page would keep that memory until it
 * reloaded. `../decode.ts` ends the worker after each file, which frees it.
 *
 * The `.wasm` binary is a separate asset (`?url`), fetched with this worker
 * only when a HEIC needs it. (libheif-js's ES-module build inlines it as base64:
 * one 2 MB chunk, larger to download and over Vite's chunk-size warning.) The
 * glue's Node-only `require`s are stubbed at build time; see
 * `libheifNodeBuiltinsStub` in `vite.config.ts`.
 *
 * A worker script is served as JavaScript, and the server sets the
 * Content-Security-Policy only on HTML documents (`registerCspReportingHeaders`
 * in `webapp/server-root/root-routes.ts`), so compiling WebAssembly here needs
 * no `'wasm-unsafe-eval'` in the page policy.
 */

import libheifFactory from "libheif-js/libheif-wasm/libheif.js";
import wasmUrl from "libheif-js/libheif-wasm/libheif.wasm?url";
import { decodeHeifPrimary, loadLibheif } from "./libheif";
import type { HeifWorkerReply, HeifWorkerRequest } from "../protocol";

// The DOM lib types `self` as a Window; the two calls used here have the same
// shape on a DedicatedWorkerGlobalScope.
self.addEventListener("message", (event: MessageEvent<HeifWorkerRequest>) => {
  void decode(event.data.bytes).then(reply);
});

// A rejection nothing awaits (Emscripten glue runs some work in detached async
// callbacks) would otherwise leave the page waiting for a reply forever.
self.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  reply({ ok: false, stage: "decode", error: message(event.reason) });
});

function reply(result: HeifWorkerReply): void {
  self.postMessage(result, { transfer: result.ok ? [result.pixels.buffer] : [] });
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function decode(bytes: ArrayBuffer): Promise<HeifWorkerReply> {
  let libheif;
  try {
    libheif = await loadLibheif(libheifFactory, { wasmUrl });
  } catch (e) {
    return { ok: false, stage: "load", error: message(e) };
  }
  try {
    const { width, height, pixels } = decodeHeifPrimary(libheif, new Uint8Array(bytes));
    return { ok: true, width, height, pixels };
  } catch (e) {
    return { ok: false, stage: "decode", error: message(e) };
  }
}
