/**
 * Plaintext renderer — catch-all fallback for any text file.
 *
 * Reads the shell-loaded content and renders as monospace. Registered at
 * priority 1 for every non-card, non-directory path so something always
 * matches. Binary files (images, audio, etc.) use their own renderers.
 */

import { registerFileRenderer, type RendererProps } from "./index";
import { Pre } from "../components/ui/Pre";
import { Text } from "../components/ui/Text";

function PlaintextRenderer({ data }: RendererProps) {
  if (data.content === undefined) {
    return (
      <div className="p-4">
        <Text tone="subtle">No text content available</Text>
      </div>
    );
  }
  return (
    <div className="p-4">
      <Pre boxed>{data.content}</Pre>
    </div>
  );
}

// Binary/data extensions whose preferred renderer is not plaintext.
const BINARY_EXTS = /\.(png|jpe?g|gif|webp|bmp|svg|ico|mp3|m4a|mp4|wav|webm|ogg|aac|flac|pdf|zip|card)$/i;

registerFileRenderer(
  (path) => {
    // Only match files with an extension (skip directories) and not binary.
    const base = path.split("/").pop();
    if (!base || !base.includes(".")) return false;
    return !BINARY_EXTS.test(base);
  },
  { name: "Plaintext", Component: PlaintextRenderer, priority: 1 },
);
