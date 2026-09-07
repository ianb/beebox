/**
 * Upload helper for chat file attachments — the producer behind an inline
 * `[file#N]`.
 *
 * A file routed inline (`components/chat/file-routing.ts`) is POSTed multipart
 * to `/api/chat/upload-file` *before* the message is sent. The server writes it
 * to `<boxRoot>/tmp/` and returns the relative path; the composer inserts a
 * `[file#N]` token at the cursor and emits a sibling `<attachments>` block
 * mapping each token to its path on send. So the file never rides in the
 * `/chat/send` body the way an inline photo does — only its path does.
 *
 * The native iOS composer uploads to the same route (`Services/ChatAPI.swift`).
 */

import { z } from "zod";
import { getApiBase } from "../api";
import { withMobileAuth } from "./mobile-auth";
import { isRecord } from "@shared/is-record";
import { errorMessage } from "@shared/error-guards";

/** Server response shape of POST /api/chat/upload-file (see routes/chat-uploads.ts). */
const uploadedFileSchema = z.object({
  /** Path relative to box root, e.g. "tmp/2026-04-27T15-30-12-987Z_report.pdf". */
  path: z.string(),
  originalName: z.string(),
  size: z.number(),
  mimetype: z.string(),
});

export type UploadedFile = z.infer<typeof uploadedFileSchema>;

/** The transfer never completed — the connection dropped mid-upload. */
class ChatFileUploadNetworkError extends Error {
  constructor() {
    super("The connection dropped before the file finished uploading.");
    this.name = "ChatFileUploadNetworkError";
  }
}

/** The transfer was aborted (the page navigated away, or a caller cancelled it). */
class ChatFileUploadAbortedError extends Error {
  constructor() {
    super("The file upload was cancelled.");
    this.name = "ChatFileUploadAbortedError";
  }
}

/** The route refused the upload — too large, unreadable, or unauthorized. */
class ChatFileUploadRejectedError extends Error {
  constructor(opts: { detail: string }) {
    super(`The box refused the upload: ${opts.detail}`);
    this.name = "ChatFileUploadRejectedError";
  }
}

/** The route answered 2xx with something that isn't an uploaded-file record. */
class ChatFileUploadMalformedResponseError extends Error {
  constructor(opts: { detail: string }) {
    super(`The box's reply to the upload could not be read: ${opts.detail}`);
    this.name = "ChatFileUploadMalformedResponseError";
  }
}

/**
 * Upload one file, reporting progress as it goes.
 *
 * `XMLHttpRequest` rather than `fetch`: only the former reports upload
 * progress, and a file attachment that shows no sign of moving is
 * indistinguishable from a hung one (the composer renders this as the chip's
 * progress bar). The body is multipart, which is what the route parses —
 * unlike the bulk route's raw octet-stream.
 */
export function uploadChatFile(file: File, opts: {
  /** Fraction moved, 0–1. Called with 0 at least once, before any bytes go. */
  onProgress: (fraction: number) => void;
}): Promise<UploadedFile> {
  const { onProgress } = opts;
  const form = new FormData();
  form.append("file", file, file.name);
  const init = withMobileAuth({ method: "POST", body: form });
  return new Promise<UploadedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getApiBase()}/chat/upload-file`);
    // `withMobileAuth` decorates a fetch init; carry whatever headers it added
    // (the paired-device token) onto the equivalent XHR.
    for (const [name, value] of new Headers(init.headers).entries()) {
      xhr.setRequestHeader(name, value);
    }
    onProgress(0);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => { reject(new ChatFileUploadNetworkError()); };
    xhr.onabort = () => { reject(new ChatFileUploadAbortedError()); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        // The route answers with `{error}` on a refusal; fall back to the status
        // line when the body isn't the shape we expect (a proxy's error page).
        let detail = xhr.statusText === "" ? `status ${String(xhr.status)}` : xhr.statusText;
        try {
          const body: unknown = JSON.parse(xhr.responseText);
          if (isRecord(body) && typeof body.error === "string") detail = body.error;
        } catch (_e) { /* ignore: a non-JSON error body just leaves the status line */ }
        reject(new ChatFileUploadRejectedError({ detail }));
        return;
      }
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(xhr.responseText);
      } catch (e) {
        reject(new ChatFileUploadMalformedResponseError({ detail: errorMessage(e) }));
        return;
      }
      const parsed = uploadedFileSchema.safeParse(parsedBody);
      if (!parsed.success) {
        reject(new ChatFileUploadMalformedResponseError({ detail: parsed.error.message }));
        return;
      }
      onProgress(1);
      resolve(parsed.data);
    };
    xhr.send(form);
  });
}
