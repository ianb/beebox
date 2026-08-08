import type { ChatBackend } from "../../../services/claude-chat.js";
import type { ChatSession, ChatSessionOptions } from "./index.js";

export interface RegistryEntry {
  session: ChatSession;
  lastActivity: number;
  lastSubprocessUse: number;
  refCount: number;
}

export interface ChatSessionRegistryOptions {
  maxLiveProcesses?: number;
  idleTimeoutMs?: number;
  cleanupIntervalMs?: number;
  buildSessionOptions?: (sessionId: string | null) => ChatSessionOptions;
  backend?: ChatBackend;
  now?: () => number;
}
