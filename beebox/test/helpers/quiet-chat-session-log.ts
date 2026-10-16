/**
 * Keep chat-session logs out of test output.
 *
 * Loaded by `.taprc`'s `node-arg` in every test process. A test that drives a
 * real `ChatSession` or `ChatSessionRegistry` otherwise prints its
 * `[ChatSession:…]` lines (src/core/chat/session/log.ts) into the TAP stream;
 * capture/prepare.doctest.md alone printed 42. Child processes a test spawns
 * inherit the setting. A test that sets `BBX_CHAT_SESSION_LOG` itself keeps
 * its own value.
 */

if (process.env["BBX_CHAT_SESSION_LOG"] === undefined) {
  process.env["BBX_CHAT_SESSION_LOG"] = "off";
}

export {};
