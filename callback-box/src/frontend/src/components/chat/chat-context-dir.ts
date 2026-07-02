/**
 * The chat's working directory (the Agent SDK `cwd`), provided to the deep
 * markdown renderer without prop-drilling through every message component.
 *
 * Markdown link/embed paths resolve against it like a shell: a box-root-absolute
 * `/store/…` path ignores it; a bare `foo.card` resolves relative to it. The
 * agent is instructed to write absolute paths; the cwd fallback rescues a bare
 * one. `null`/undefined means "resolve relative paths against the box root".
 */

import { createContext, useContext } from "react";

const ChatContextDir = createContext<string | undefined>(undefined);

export const ChatContextDirProvider = ChatContextDir.Provider;

export function useChatContextDir(): string | undefined {
  return useContext(ChatContextDir);
}
