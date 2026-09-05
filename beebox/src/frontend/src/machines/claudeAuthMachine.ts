/**
 * XState machine for Claude Code authentication flow.
 *
 * States: loading → idle → (login flow | logout flow) → idle
 *
 * The login flow: starting → polling (with 3min timeout) → idle
 * Polling uses a callback actor with setInterval.
 */

import { setup, assign, fromPromise, fromCallback } from "xstate";
import { trpcClient } from "../lib/trpc";
import { RequestError } from "../lib/errors";
import { errorMessage } from "@shared/error-guards";

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
  | { type: "SUBMIT_CODE"; code: string }
  | { type: "LOGGED_IN"; status: ClaudeStatus }
  | { type: "POLL_RESULT"; status: ClaudeStatus };

// -- Actors --

const fetchStatus = fromPromise<ClaudeStatus>(async () => {
  return trpcClient.admin.claudeStatus.query();
});

const startLogin = fromPromise(async () => {
  // claudeLogin throws on failure and always returns a non-empty authUrl.
  const { authUrl } = await trpcClient.admin.claudeLogin.mutate();
  return authUrl;
});

const submitCode = fromPromise<void, { code: string }>(async ({ input }) => {
  await trpcClient.admin.claudeSubmitCode.mutate({ code: input.code });
});

const doLogout = fromPromise<ClaudeStatus>(async () => {
  const result = await trpcClient.admin.claudeLogout.mutate();
  if (!result.success) {
    throw new RequestError(result.error || "Logout failed");
  }
  // Fetch fresh status after logout.
  return trpcClient.admin.claudeStatus.query();
});

const pollForLogin = fromCallback(({ sendBack }) => {
  const id = setInterval(() => {
    trpcClient.admin.claudeStatus
      .query()
      .then((status) => {
        sendBack({ type: "POLL_RESULT", status });
      })
      .catch((e: unknown) => {
        // Transient poll failure (network/offline); the interval retries
        // every 3s so this isn't fatal, but retry-resilience and
        // observability are different properties -- log at debug level
        // (routine, only forwarded to the client-debug-log when the debug
        // panel is open) so a persistently failing poll is still visible
        // without spamming the always-forwarded error/warn log.
        console.debug("[claudeAuth] status poll failed:", e);
      });
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
    submitCode,
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
            error: errorMessage(event.error),
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
            error: errorMessage(event.error),
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
        SUBMIT_CODE: "submittingCode",
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
    // The sign-in page hands the person a code; the CLI reads it from stdin.
    // Polling keeps running underneath: `polling` is re-entered on success and
    // its status query is what finally flips loggedIn.
    submittingCode: {
      invoke: {
        src: "submitCode",
        input: ({ event }) => ({ code: event.type === "SUBMIT_CODE" ? event.code : "" }),
        onDone: { target: "polling", actions: assign({ error: null }) },
        onError: {
          target: "polling",
          actions: assign(({ event }) => ({ error: errorMessage(event.error) })),
        },
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
            error: errorMessage(event.error),
          })),
        },
      },
    },
  },
});
