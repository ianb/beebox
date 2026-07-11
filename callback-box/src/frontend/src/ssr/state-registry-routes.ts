/**
 * Per-route scenario configs for SSR rendering.
 *
 * Maps each route to the machines it uses and the named scenarios
 * (machine states + tRPC query overrides) it can be rendered in.
 */

import type { RouteConfig } from "./state-registry-types";

// --- Route configs ---

export const routeConfigs: Record<string, RouteConfig> = {
  "/": {
    machines: ["sse"],
    scenarios: {
      default: {
        description: "Dashboard with live data from box",
        machines: { sse: "disconnected" },
      },
      empty: {
        description: "Empty dashboard — no inbox, no schedules",
        machines: { sse: "disconnected" },
        queryOverrides: {
          "status.status": {
            boxRoot: "/tmp/empty-box",
            boxVersion: "1.0.0",
            created: "2026-01-01T00:00:00Z",
            git: { staged: [], modified: [], untracked: [], clean: true },
            counts: { inbox: 0, questions: 0, pendingQuestions: 0 },
          },
          "scheduler.schedules": [],
          "scheduler.log": [],
          "status.activity": [],
          "status.questions": [],
        },
      },
      busy: {
        description: "Dashboard with many items",
        machines: { sse: "disconnected" },
        // Uses live data — no overrides
      },
    },
  },
  "/chat": {
    machines: ["sse", "chat", "speechPlayback", "realtimeTranscription"],
    scenarios: {
      default: {
        description: "Chat with message history",
        machines: { sse: "disconnected", chat: "idle" },
      },
      idle: {
        description: "Chat with history, not streaming",
        machines: { sse: "disconnected", chat: "idle" },
      },
      streaming: {
        description: "Chat mid-response with partial text",
        machines: { sse: "connected", chat: "streaming" },
      },
      empty: {
        description: "Fresh chat — no messages",
        machines: { sse: "disconnected", chat: "idle" },
        queryOverrides: {
          "chat.history": { sessionId: null, entries: [] },
          "chat.status": { sessionId: null, running: false, busy: false },
        },
      },
      error: {
        description: "Chat with error banner",
        machines: {
          sse: "disconnected",
          chat: "idle",
        },
        queryOverrides: {
          "chat.history": { sessionId: null, entries: [] },
        },
      },
    },
  },
  "/settings": {
    machines: ["sse", "claudeAuth"],
    scenarios: {
      default: {
        description: "Settings with Claude logged in",
        machines: { sse: "disconnected", claudeAuth: "idle" },
      },
      loggedOut: {
        description: "Settings with Claude not authenticated",
        machines: { sse: "disconnected", claudeAuth: "idle" },
      },
      polling: {
        description: "Settings during auth flow — waiting for OAuth",
        machines: { sse: "disconnected", claudeAuth: "polling" },
      },
    },
  },
  "/questions": {
    machines: ["sse"],
    scenarios: {
      default: {
        description: "Questions page with live data",
        machines: { sse: "disconnected" },
      },
      empty: {
        description: "No pending questions",
        machines: { sse: "disconnected" },
        queryOverrides: { "status.questions": [] },
      },
    },
  },
  "/history": {
    machines: ["sse"],
    scenarios: {
      default: {
        description: "History page with live data",
        machines: { sse: "disconnected" },
      },
    },
  },
  "/browse": {
    machines: ["sse"],
    scenarios: {
      default: {
        description: "Browse page with live data",
        machines: { sse: "disconnected" },
      },
    },
  },
};
