/**
 * XState machine for Server-Sent Events connection.
 *
 * States: connecting → connected / waiting → reconnect cycle
 *
 * The EventSource lives in a callback actor's closure.
 * Auto-reconnects after 5 seconds on error.
 */

import { setup, assign, fromCallback } from "xstate";

export interface SSEEvent {
  event: string;
  data: unknown;
}

type SSEMachineEvent =
  | { type: "CONNECTED" }
  | { type: "EVENT"; sseEvent: SSEEvent }
  | { type: "ERROR" }
  | { type: "DISCONNECT" }
  | { type: "RECONNECT" };

interface SSEMachineContext {
  url: string;
  lastEvent: SSEEvent | null;
}

const EVENT_TYPES = [
  "connected",
  "ping",
  "file-change",
  "wakeup-start",
  "wakeup-complete",
  "question-answered",
  "card-created",
];

interface SSEActorInput {
  url: string;
}

const sseActor = fromCallback<
  { type: "CLOSE" },
  SSEActorInput,
  SSEMachineEvent
>(({ sendBack, input }) => {
  const eventSource = new EventSource(input.url);

  eventSource.onopen = () => {
    sendBack({ type: "CONNECTED" });
  };

  eventSource.onerror = () => {
    sendBack({ type: "ERROR" });
  };

  for (const eventType of EVENT_TYPES) {
    eventSource.addEventListener(eventType, (event) => {
      const sseEvent: SSEEvent = {
        event: eventType,
        data: JSON.parse((event as MessageEvent).data),
      };
      sendBack({ type: "EVENT", sseEvent });
    });
  }

  return () => {
    eventSource.close();
  };
});

export const sseMachine = setup({
  types: {
    context: {} as SSEMachineContext,
    events: {} as SSEMachineEvent,
    input: {} as { url: string },
  },
  actors: {
    sseActor,
  },
  delays: {
    RECONNECT_DELAY: 5000,
  },
}).createMachine({
  id: "sse",
  initial: "connecting",
  context: ({ input }) => ({
    url: input.url,
    lastEvent: null,
  }),
  states: {
    connecting: {
      invoke: {
        id: "eventSource",
        src: "sseActor",
        input: ({ context }) => ({ url: context.url }),
      },
      on: {
        CONNECTED: "connected",
        ERROR: "waiting",
        EVENT: {
          actions: assign(({ event }) => ({ lastEvent: event.sseEvent })),
        },
      },
    },
    connected: {
      on: {
        EVENT: {
          actions: assign(({ event }) => ({ lastEvent: event.sseEvent })),
        },
        ERROR: "waiting",
        DISCONNECT: "disconnected",
      },
    },
    waiting: {
      after: {
        RECONNECT_DELAY: "connecting",
      },
    },
    disconnected: {
      on: {
        RECONNECT: "connecting",
      },
    },
  },
});
