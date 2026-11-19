/**
 * Plaintext renderer — catch-all fallback for any text file.
 *
 * Reads the shell-loaded content and renders as monospace. Registered at
 * priority 1 for every non-card, non-directory path so something always
 * matches. Binary files (images, audio, etc.) use their own renderers.
 */

import { isPlaintextPath } from "../components/file-view-data";
import { CardThemeContent } from "../components/themes/CardThemeContent";
import { Pre } from "../components/ui/Pre";
import { StatusMessage } from "../components/ui/StatusMessage";
import type { RendererEntry, RendererProps } from "../file-type-registry";

function PlaintextRenderer({ data, mode }: RendererProps) {
  if (data.content === undefined) {
    return <StatusMessage className="p-4">No text content available</StatusMessage>;
  }
  const body = <Pre>{data.content}</Pre>;
  // Outside an embed FileView draws the card surface; inside one the host card is the frame.
  if (mode !== "embed") return <CardThemeContent>{body}</CardThemeContent>;
  return <div className="p-4">{body}</div>;
}

export const plaintextRenderer: RendererEntry = {
  // JSON has its own size-gated renderer; the shell doesn't prefetch its text.
  selector: { match: isPlaintextPath },
  renderer: { name: "Plaintext", Component: PlaintextRenderer, priority: 1 },
};
