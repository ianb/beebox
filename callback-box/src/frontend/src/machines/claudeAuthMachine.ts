/**
 * XState machine for Claude Code authentication flow.
 *
 * States: loading → idle → (login flow | logout flow) → idle
 *
 * The login flow: starting → polling (with 3min timeout) → idle
 * Polling uses a callback actor with setInterval.
 */

import { setup, assign, fromPromise, fromCallback } from "xstate";
import { withBase } from "../api";
import { RequestError } from "../lib/errors";

interface ClaudeStatus {
  loggedIn?: boolean;
  email?: string;
  error?: string;
  raw?: string;
  [key: string]: unknown;
}

interface ClaudeAuthContext {
  status: ClaudeStatus | null;
  error: string | null;
  authUrl: string | null;
}

type ClaudeAuthEvent =
  | { type: "LOGIN" }
  | { type: "LOGOUT" }
  | { type: "REFRESH" }
  | { type: "LOGGED_IN"; status: ClaudeStatus }
  | { type: "POLL_RESULT"; status: ClaudeStatus };

// -- Actors --

const fetchStatus = fromPromise(async () => {
  const resp = await fetch(withBase("/api/admin/claude-status"));
  if (!resp.ok) {
    const message = `Status check failed: ${resp.status}`;
    throw new RequestError(message);
  }
  return (await resp.json()) as ClaudeStatus;
});

const startLogin = fromPromise(async () => {
  const resp = await fetch(withBase("/api/admin/claude-login"), { method: "POST" });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new RequestError(data.error || "Login failed");
  }
  const result = (await resp.json()) as { authUrl?: string; error?: string };
  if (!result.authUrl) {
    throw new RequestError(result.error || "No auth URL received");
  }
  return result.authUrl;
});

const doLogout = fromPromise(async () => {
  const resp = await fetch(withBase("/api/admin/claude-logout"), { method: "POST" });
  const data = await resp.json();
  if (!data.success) {
    throw new RequestError(data.error || "Logout failed");
  }
  // Fetch fresh status after logout
  const statusResp = await fetch(withBase("/api/admin/claude-status"));
  if (!statusResp.ok) {
    const message = `Status check failed: ${statusResp.status}`;
    throw new RequestError(message);
  }
  return (await statusResp.json()) as ClaudeStatus;
});

const pollForLogin = fromCallback(({ sendBack }) => {
  const id = setInterval(async () => {
    try {
      const resp = await fetch(withBase("/api/admin/claude-status"));
      if (resp.ok) {
        const status = (await resp.json()) as ClaudeStatus;
        sendBack({ type: "POLL_RESULT", status });
      }
    } catch (_e) {
      // Transient poll failure (network/offline); the interval retries every
      // 3s, so logging each miss would just spam.
    }
  }, 3000);
  return () => clearInterval(id);
});

// -- Machine --

export const claudeAuthMachine = setup({
  types: {
    context: {} as ClaudeAuthContext,
    events: {} as ClaudeAuthEvent,
  },
  actors: {
    fetchStatus,
    startLogin,
    doLogout,
    pollForLogin,
  },
  delays: {
    POLL_TIMEOUT: 180_000, // 3 minutes
  },
}).createMachine({
  id: "claudeAuth",
  initial: "loading",
  context: {
    status: null,
    error: null,
    authUrl: null,
  },
  states: {
    loading: {
      invoke: {
        src: "fetchStatus",
        onDone: {
          target: "idle",
          actions: assign(({ event }) => ({
            status: event.output,
            error: null,
          })),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: (event.error as Error).message,
          })),
        },
      },
    },
    idle: {
      on: {
        LOGIN: "starting",
        LOGOUT: "loggingOut",
        REFRESH: "loading",
      },
    },
    starting: {
      entry: assign({ error: null, authUrl: null }),
      invoke: {
        src: "startLogin",
        onDone: {
          target: "polling",
          actions: assign(({ event }) => ({
            authUrl: event.output,
          })),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: (event.error as Error).message,
          })),
        },
      },
    },
    polling: {
      invoke: {
        src: "pollForLogin",
      },
      after: {
        POLL_TIMEOUT: {
          target: "idle",
          actions: assign({ authUrl: null }),
        },
      },
      on: {
        POLL_RESULT: [
          {
            guard: ({ event }) => event.status.loggedIn === true,
            target: "idle",
            actions: assign(({ event }) => ({
              status: event.status,
              authUrl: null,
              error: null,
            })),
          },
        ],
      },
    },
    loggingOut: {
      invoke: {
        src: "doLogout",
        onDone: {
          target: "idle",
          actions: assign(({ event }) => ({
            status: event.output,
            error: null,
          })),
        },
        onError: {
          target: "idle",
          actions: assign(({ event }) => ({
            error: (event.error as Error).message,
          })),
        },
      },
    },
  },
});
