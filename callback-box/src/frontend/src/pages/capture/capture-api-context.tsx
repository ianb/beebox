/**
 * Injectable capture-API surface.
 *
 * The capture hooks (`useCaptureSession`, `useCaptureUploads`) talk to the box
 * through this small interface rather than importing the fetch helpers directly,
 * so the dev harness can mount capture mode against an in-memory fake — no mic,
 * camera, or backend — by wrapping the tree in `CaptureApiProvider`. Production
 * gets the real `capture-api.ts` implementation via the context default.
 */

import { createContext, useContext, type ReactNode } from "react";
import {
  createCaptureSession,
  finalizeCaptureSession,
  cancelCaptureSession,
  uploadCaptureFile,
} from "./capture-api";

/** The capture lifecycle + upload calls the hooks depend on. */
export interface CaptureApi {
  createCaptureSession: typeof createCaptureSession;
  finalizeCaptureSession: typeof finalizeCaptureSession;
  cancelCaptureSession: typeof cancelCaptureSession;
  uploadCaptureFile: typeof uploadCaptureFile;
}

/** The real, network-backed implementation (the production default). */
export const realCaptureApi: CaptureApi = {
  createCaptureSession,
  finalizeCaptureSession,
  cancelCaptureSession,
  uploadCaptureFile,
};

const CaptureApiContext = createContext<CaptureApi>(realCaptureApi);

export function CaptureApiProvider({ value, children }: { value: CaptureApi; children: ReactNode }) {
  return <CaptureApiContext.Provider value={value}>{children}</CaptureApiContext.Provider>;
}

/** The active capture API — the real one unless a provider overrides it. */
export function useCaptureApi(): CaptureApi {
  return useContext(CaptureApiContext);
}
