/**
 * XState machine for Server-Sent Events connection.
 *
 * States: connecting → connected / waiting → reconnect cycle
 *
 * The EventSource lives in a callback actor's closure.
 * Auto-reconnects after 5 seconds on error.
 * Tracks lastEventId for replay on reconnect via Last-Event-ID header.
 */

import { setup, assign, fromCallback } from "xstate";

export interface SSEEvent {
  event: string;
  data: unknown;
  id?: string;
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
  lastEventId: string;
}

const EVENT_TYPES = [
  "connected",
  "ping",
  "file-change",
  "wakeup-start",
  "wakeup-complete",
  "wakeup-error",
  "question-answered",
  "card-created",
  "cards-changed",
  "command-complete",
  "schedule-fired",
  "chat-complete",
  "chat-history",
];

interface SSEActorInput {
  url: string;
  lastEventId: string;
}

const sseActor = fromCallback<
  { type: "CLOSE" },
  SSEActorInput,
  SSEMachineEvent
>(({ sendBack, input }) => {
  // Build URL with lastEventId query param for replay on reconnect.
  // The server reads the Last-Event-ID header (sent automatically by
  // EventSource on its own reconnects) but since our state machine
  // creates a fresh EventSource each time, we pass it as a query param too.
  let url = input.url;
  if (input.lastEventId && input.lastEventId !== "0") {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}lastEventId=${input.lastEventId}`;
  }

  console.log("[sse] Connecting to", url);
  const eventSource = new EventSource(url, { withCredentials: true });

  eventSource.onopen = () => {
    console.log("[sse] Connected");
    sendBack({ type: "CONNECTED" });
  };

  eventSource.onerror = () => {
    // EventSource.onerror provides no details. Log readyState and
    // do a diagnostic fetch to surface the actual HTTP error.
    const state = eventSource.readyState === EventSource.CLOSED ? "CLOSED" : "CONNECTING";
    console.warn(`[sse] Connection error (readyState: ${state})`);
    fetch(url, { credentials: "include" }).then((res) => {
      if (!res.ok) {
        console.warn(`[sse] Diagnostic fetch: ${res.status} ${res.statusText}`);
      }
    }).catch((err) => {
      console.warn("[sse] Diagnostic fetch failed:", err.message);
    });
    sendBack({ type: "ERROR" });
  };

  for (const eventType of EVENT_TYPES) {
    eventSource.addEventListener(eventType, (event) => {
      const me = event as MessageEvent;
      const sseEvent: SSEEvent = {
        event: eventType,
        data: JSON.parse(me.data),
        id: me.lastEventId || undefined,
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
  initial: "active",
  context: ({ input }) => ({
    url: input.url,
    lastEvent: null,
    lastEventId: "0",
  }),
  on: {
    EVENT: {
      actions: assign(({ context, event }) => ({
        lastEvent: event.sseEvent,
        lastEventId: event.sseEvent.id || context.lastEventId,
      })),
    },
  },
  states: {
    active: {
      invoke: {
        id: "eventSource",
        src: "sseActor",
        input: ({ context }) => ({ url: context.url, lastEventId: context.lastEventId }),
      },
      initial: "connecting",
      states: {
        connecting: {
          on: {
            CONNECTED: "connected",
          },
        },
        connected: {},
      },
      on: {
        ERROR: "waiting",
        DISCONNECT: "disconnected",
      },
    },
    waiting: {
      after: {
        RECONNECT_DELAY: "active",
      },
    },
    disconnected: {
      on: {
        RECONNECT: "active",
      },
    },
  },
});
