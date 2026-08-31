import { assign, fromCallback, fromPromise, setup } from "xstate";
import { errorMessage } from "@shared/error-guards";
import { trpcClient } from "../lib/trpc";
import { RequestError } from "../lib/errors";

export type CodexStatus = Awaited<ReturnType<typeof trpcClient.admin.codexStatus.query>>;

interface CodexAuthContext {
  status: CodexStatus | null;
  error: string | null;
  verificationUrl: string | null;
  userCode: string | null;
}

type CodexAuthEvent =
  | { type: "LOGIN" }
  | { type: "CANCEL" }
  | { type: "LOGOUT" }
  | { type: "REFRESH" }
  | { type: "POLL_RESULT"; status: CodexStatus };

const fetchStatus = fromPromise(async () => trpcClient.admin.codexStatus.query());
const startLogin = fromPromise(async () => trpcClient.admin.codexLogin.mutate());
const cancelLogin = fromPromise(async () => trpcClient.admin.codexCancelLogin.mutate());
const logout = fromPromise(async () => {
  const result = await trpcClient.admin.codexLogout.mutate();
  if (!result.success) throw new RequestError(result.error ?? "Logout failed");
  return trpcClient.admin.codexStatus.query();
});
const pollForLogin = fromCallback(({ sendBack }) => {
  const id = setInterval(() => {
    trpcClient.admin.codexStatus.query()
      .then((status) => { sendBack({ type: "POLL_RESULT", status }); })
      .catch((error: unknown) => { console.debug("[codexAuth] status poll failed:", error); });
  }, 3000);
  return () => clearInterval(id);
});

export const codexAuthMachine = setup({
  types: {
    context: {} as CodexAuthContext,
    events: {} as CodexAuthEvent,
  },
  actors: { fetchStatus, startLogin, cancelLogin, logout, pollForLogin },
  delays: { POLL_TIMEOUT: 10 * 60_000 },
}).createMachine({
  id: "codexAuth",
  initial: "loading",
  context: { status: null, error: null, verificationUrl: null, userCode: null },
  states: {
    loading: {
      invoke: {
        src: "fetchStatus",
        onDone: { target: "idle", actions: assign(({ event }) => ({ status: event.output, error: null })) },
        onError: { target: "idle", actions: assign(({ event }) => ({ error: errorMessage(event.error) })) },
      },
    },
    idle: { on: { LOGIN: "starting", LOGOUT: "loggingOut", REFRESH: "loading" } },
    starting: {
      entry: assign({ error: null, verificationUrl: null, userCode: null }),
      invoke: {
        src: "startLogin",
        onDone: {
          target: "polling",
          actions: assign(({ event }) => ({
            verificationUrl: event.output.verificationUrl,
            userCode: event.output.userCode,
          })),
        },
        onError: { target: "idle", actions: assign(({ event }) => ({ error: errorMessage(event.error) })) },
      },
    },
    polling: {
      invoke: { src: "pollForLogin" },
      after: {
        POLL_TIMEOUT: {
          target: "cancelling",
          actions: assign({ error: "Codex authentication timed out — start again" }),
        },
      },
      on: {
        CANCEL: "cancelling",
        POLL_RESULT: [
          {
            guard: ({ event }) => event.status.kind === "logged-in",
            target: "idle",
            actions: assign(({ event }) => ({
              status: event.status,
              verificationUrl: null,
              userCode: null,
              error: null,
            })),
          },
          {
            guard: ({ event }) => event.status.kind === "logged-out" && event.status.detail !== undefined,
            target: "idle",
            actions: assign(({ event }) => ({
              status: event.status,
              verificationUrl: null,
              userCode: null,
              error: null,
            })),
          },
        ],
      },
    },
    cancelling: {
      invoke: {
        src: "cancelLogin",
        onDone: { target: "idle", actions: assign({ verificationUrl: null, userCode: null }) },
        onError: { target: "idle", actions: assign(({ event }) => ({ error: errorMessage(event.error) })) },
      },
    },
    loggingOut: {
      invoke: {
        src: "logout",
        onDone: { target: "idle", actions: assign(({ event }) => ({ status: event.output, error: null })) },
        onError: { target: "idle", actions: assign(({ event }) => ({ error: errorMessage(event.error) })) },
      },
    },
  },
});
