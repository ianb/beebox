/**
 * Upload helper for chat file attachments.
 *
 * Files are POSTed multipart to /api/chat/upload-file. The server writes them
 * to <boxRoot>/tmp/ and returns the relative path. The composer then inserts
 * a `[fileN]` token in the textarea and emits a sibling `<attachments>` block
 * mapping each token to its path on send.
 */

import { getApiBase } from "../api";
import { RequestError } from "./errors";
import { withMobileAuth } from "./mobile-auth";

export interface UploadedFile {
  /** Path relative to box root, e.g. "tmp/2026-04-27T15-30-12-987Z_report.pdf". */
  path: string;
  originalName: string;
  size: number;
  mimetype: string;
}

export async function uploadChatFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(`${getApiBase()}/chat/upload-file`, withMobileAuth({
    method: "POST",
    body: form,
  }));
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new RequestError(err.error || "File upload failed");
  }
  return (await response.json()) as UploadedFile;
}
