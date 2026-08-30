/**
 * Plaintext renderer — catch-all fallback for any text file.
 *
 * Reads the shell-loaded content and renders as monospace. Registered at
 * priority 1 for every non-card, non-directory path so something always
 * matches. Binary files (images, audio, etc.) use their own renderers.
 */

import { isBinaryPath } from "../lib/binary-files";
import { Pre } from "../components/ui/Pre";
import { Text } from "../components/ui/Text";
import { registerFileType, type RendererProps } from "./index";

function PlaintextRenderer({ data }: RendererProps) {
  if (data.content === undefined) {
    return <Text as="div" tone="subtle" className="p-4">No text content available</Text>;
  }
  return (
    <div className="p-4">
      <Pre>{data.content}</Pre>
    </div>
  );
}

registerFileType(
  {
    match: (path) => {
      // Skip directories (no extension), card files, and known binary types.
      const base = path.split("/").pop();
      if (!base || !base.includes(".")) return false;
      if (path.endsWith(".card")) return false;
      // JSON has its own renderer that loads on its own terms (size-gated); the
      // shell doesn't prefetch its text, so plaintext has nothing to show.
      if (path.endsWith(".json")) return false;
      return !isBinaryPath(path);
    },
  },
  { renderer: { name: "Plaintext", Component: PlaintextRenderer, priority: 1 } },
);
