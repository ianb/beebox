/**
 * Save logic for the PWA share-target page.
 *
 * Builds a bookmark card and POSTs it to the box's command-execute endpoint,
 * then drains the SSE response stream to confirm the command succeeded.
 * Throws RequestError on any failure so callers can surface a message.
 */

import { withBase } from "../api";
import { RequestError } from "../lib/errors";

interface SaveBookmarkOptions {
  boxSlug: string;
  sharedUrl: string;
  sharedTitle: string;
  note: string;
  usedVoice: boolean;
}

function buildCardPath(sharedTitle: string): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[.:]/g, "-").slice(0, 19);
  const safeName = (sharedTitle || "Link")
    .replace(/[^\w -]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  return `box/inbox/links/${safeName}_${timestamp}.bookmark.card`;
}

/**
 * Drain the command-execute SSE stream, throwing if it never reports success.
 */
async function confirmSuccess(response: Response): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let success = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "result" && data.success) {
            success = true;
          }
        } catch (e) {
          console.debug("Skipping unparseable SSE data line:", e);
        }
      }
    }
  }
  if (!success) {
    const message = "Command did not report success";
    throw new RequestError(message);
  }
}

/**
 * Create a bookmark card in the box inbox from a shared link + optional note.
 */
export async function saveBookmark(options: SaveBookmarkOptions): Promise<void> {
  const { boxSlug, sharedUrl, sharedTitle, note, usedVoice } = options;

  const cardPath = buildCardPath(sharedTitle);

  let noteText = note;
  if (noteText && usedVoice) {
    noteText = `[Audio Input Transcription]\n${noteText}`;
  }

  const args: Record<string, unknown> = {
    path: cardPath,
    commit: true,
    args: {
      title: sharedTitle || sharedUrl,
      link: sharedUrl,
      ...(noteText ? { note: noteText } : {}),
    },
  };

  const response = await fetch(withBase(`/${boxSlug}/api/commands/execute`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "create", args }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new RequestError(err.error || "Save failed");
  }

  await confirmSuccess(response);
}
