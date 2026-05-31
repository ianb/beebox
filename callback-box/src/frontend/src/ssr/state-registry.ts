/**
 * State registry for SSR rendering scenarios.
 *
 * Declares per-machine metadata and per-route scenarios so that
 * `cb render` can enumerate possible states and render arbitrary
 * UI situations (streaming, empty, error, etc.) without live data.
 */

import type { AnyStateMachine } from "xstate";
import { chatMachine } from "../machines/chatMachine";
import { sseMachine } from "../machines/sseMachine";
import { claudeAuthMachine } from "../machines/claudeAuthMachine";
import { speechPlaybackMachine } from "../machines/speechPlaybackMachine";
import { voiceRecorderMachine } from "../machines/voiceRecorderMachine";
import { realtimeTranscriptionMachine } from "../machines/realtimeTranscriptionMachine";
import type { SessionEntry, SessionContentBlock } from "../api";

class RegistryLookupError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "RegistryLookupError";
  }
}

// --- Types ---

export interface MachineStateInfo {
  machine: AnyStateMachine;
  /** Input needed for graph traversal (machines with required input) */
  input?: Record<string, unknown>;
  /** Per-state context overrides for rendering */
  states: Record<string, { context?: Record<string, unknown> }>;
}

export interface RouteScenario {
  description: string;
  /** machineId → state value */
  machines?: Record<string, string>;
  /** tRPC procedure path (dot-separated) → mock data */
  queryOverrides?: Record<string, unknown>;
}

export interface RouteConfig {
  /** Machine IDs used by this route */
  machines: string[];
  scenarios: Record<string, RouteScenario>;
}

// --- Sample data ---

const sampleMessages: SessionEntry[] = [
  {
    uuid: "sample-001",
    type: "user",
    timestamp: "2026-03-04T10:30:00Z",
    content: [{ type: "text", text: "What's in the inbox today?" }],
  },
  {
    uuid: "sample-002",
    type: "assistant",
    timestamp: "2026-03-04T10:30:05Z",
    content: [
      {
        type: "text",
        text: "You have 3 items in the inbox. Let me check the details.",
      },
    ],
  },
  {
    uuid: "sample-003",
    type: "user",
    timestamp: "2026-03-04T10:31:00Z",
    content: [{ type: "text", text: "Summarize them for me" }],
  },
];

const sampleStreamTools: SessionContentBlock[] = [
  {
    type: "tool_use",
    toolName: "Read",
    toolId: "tool-001",
    inputSummary: "box/inbox/note.card",
  },
];

// --- Machine registry ---

export const machineRegistry: Record<string, MachineStateInfo> = {
  sse: {
    machine: sseMachine,
    input: { url: "http://localhost:3210/test1/api/events" },
    states: {
      connecting: { context: { url: "http://localhost:3210/test1/api/events", lastEvent: null } },
      connected: { context: { url: "http://localhost:3210/test1/api/events", lastEvent: null } },
      waiting: { context: { url: "http://localhost:3210/test1/api/events", lastEvent: null } },
      disconnected: { context: { url: "", lastEvent: null } },
    },
  },
  chat: {
    machine: chatMachine,
    states: {
      loading: {
        context: {
          messages: [],
          streamText: "",
          streamTools: [],
          error: null,
          sessionId: null,
          processRunning: false,
        },
      },
      idle: {
        context: {
          messages: sampleMessages,
          streamText: "",
          streamTools: [],
          error: null,
          sessionId: "session-001",
          processRunning: false,
        },
      },
      streaming: {
        context: {
          messages: sampleMessages,
          streamText: "Let me look into that for you. I'm checking the inbox items now...",
          streamTools: sampleStreamTools,
          error: null,
          sessionId: "session-001",
          processRunning: true,
        },
      },
      refreshing: {
        context: {
          messages: sampleMessages,
          streamText: "",
          streamTools: [],
          error: null,
          sessionId: "session-001",
          processRunning: false,
        },
      },
      resetting: {
        context: {
          messages: [],
          streamText: "",
          streamTools: [],
          error: null,
          sessionId: null,
          processRunning: false,
        },
      },
    },
  },
  claudeAuth: {
    machine: claudeAuthMachine,
    states: {
      loading: { context: { status: null, error: null, authUrl: null } },
      idle: {
        context: {
          status: { loggedIn: true, email: "user@example.com" },
          error: null,
          authUrl: null,
        },
      },
      starting: { context: { status: null, error: null, authUrl: null } },
      polling: {
        context: {
          status: null,
          error: null,
          authUrl: "https://claude.ai/oauth/authorize?code=example",
        },
      },
      loggingOut: {
        context: {
          status: { loggedIn: true, email: "user@example.com" },
          error: null,
          authUrl: null,
        },
      },
    },
  },
  speechPlayback: {
    machine: speechPlaybackMachine,
    states: {
      idle: { context: { playingMessageId: null } },
      playing: { context: { playingMessageId: "sample-002" } },
    },
  },
  voiceRecorder: {
    machine: voiceRecorderMachine,
    states: {
      idle: { context: { error: null, duration: 0, startTime: 0 } },
      recording: { context: { error: null, duration: 5, startTime: Date.now() - 5000 } },
      uploading: { context: { error: null, duration: 10, startTime: 0 } },
    },
  },
  realtimeTranscription: {
    machine: realtimeTranscriptionMachine,
    states: {
      idle: { context: { transcript: "", error: null } },
      connecting: { context: { transcript: "", error: null } },
      recording: { context: { transcript: "What's on my schedule today?", error: null } },
      finalizing: { context: { transcript: "What's on my schedule today?", error: null } },
    },
  },
};

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
    machines: ["sse", "chat", "speechPlayback", "voiceRecorder", "realtimeTranscription"],
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
      recording: {
        description: "Voice recording in progress",
        machines: {
          sse: "connected",
          chat: "idle",
          voiceRecorder: "recording",
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

// --- Enumeration ---

/**
 * List declared states for a machine from the registry.
 */
export function enumerateStates(machineId: string): string[] {
  const info = machineRegistry[machineId];
  if (!info) return [];
  return Object.keys(info.states);
}

interface BuildSnapshotOptions {
  machineId: string;
  stateValue: string;
  contextOverrides?: Record<string, unknown>;
}

/**
 * Build an XState snapshot for a machine in a given state.
 */
export function buildSnapshot(opts: BuildSnapshotOptions): unknown {
  const { machineId, stateValue, contextOverrides } = opts;
  const info = machineRegistry[machineId];
  if (!info) {
    const message = `Unknown machine: ${machineId}`;
    throw new RegistryLookupError(message);
  }

  const stateInfo = info.states[stateValue];
  if (!stateInfo) {
    const message =
      `Unknown state "${stateValue}" for machine "${machineId}". ` +
      `Available: ${Object.keys(info.states).join(", ")}`;
    throw new RegistryLookupError(message);
  }

  const context = { ...stateInfo.context, ...contextOverrides };
  return info.machine.resolveState({ value: stateValue, context } as never);
}

/**
 * Build the full SSRStateMap for a route given a scenario name or
 * explicit machine state overrides.
 */
export function buildSSRStateMap(
  routePath: string,
  options?: {
    scenario?: string;
    machineOverrides?: Record<string, string>; // machineId → stateValue
  },
): Record<string, unknown> {
  options = options ?? {};
  const ssrState: Record<string, unknown> = {};
  const normalizedRoute = routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
  const routeConfig = routeConfigs[normalizedRoute];

  // Determine machine states from scenario or explicit overrides
  const machineStates: Record<string, string> = {};

  if (options.scenario && routeConfig) {
    const scenario = routeConfig.scenarios[options.scenario];
    if (!scenario) {
      const available = Object.keys(routeConfig.scenarios).join(", ");
      const message = `Unknown scenario "${options.scenario}" for route "${normalizedRoute}". Available: ${available}`;
      throw new RegistryLookupError(message);
    }
    if (scenario.machines) {
      Object.assign(machineStates, scenario.machines);
    }
  }

  // Explicit overrides take precedence
  if (options.machineOverrides) {
    Object.assign(machineStates, options.machineOverrides);
  }

  // Default: sse=disconnected if no state specified
  if (!machineStates.sse) {
    machineStates.sse = "disconnected";
  }

  // Build snapshots
  for (const [machineId, stateValue] of Object.entries(machineStates)) {
    if (machineRegistry[machineId]) {
      ssrState[machineId] = buildSnapshot({ machineId, stateValue });
    }
  }

  return ssrState;
}

/**
 * Get query overrides for a scenario.
 * Returns a map of tRPC procedure path → mock data.
 */
export function getQueryOverrides(
  routePath: string,
  scenario: string,
): Record<string, unknown> | undefined {
  const normalizedRoute = routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
  const routeConfig = routeConfigs[normalizedRoute];
  if (!routeConfig) return undefined;

  const sc = routeConfig.scenarios[scenario];
  return sc?.queryOverrides;
}

/**
 * Format state information for --list-states output.
 */
export function formatStateList(routePath: string): string {
  const normalizedRoute = routePath === "/" ? "/" : "/" + routePath.replace(/^\//, "").replace(/\/.*/, "");
  const routeConfig = routeConfigs[normalizedRoute];

  const lines: string[] = [];
  lines.push(`Route: ${normalizedRoute}`);
  lines.push("");

  if (!routeConfig) {
    lines.push("No route config found. Available routes:");
    for (const r of Object.keys(routeConfigs)) {
      lines.push(`  ${r}`);
    }
    return lines.join("\n");
  }

  lines.push("Machines:");
  for (const machineId of routeConfig.machines) {
    const states = enumerateStates(machineId);
    lines.push(`  ${machineId}: ${states.join(", ")}`);
  }

  lines.push("");
  lines.push("Scenarios:");
  const maxLen = Math.max(...Object.keys(routeConfig.scenarios).map((s) => s.length));
  for (const [name, scenario] of Object.entries(routeConfig.scenarios)) {
    lines.push(`  ${name.padEnd(maxLen + 2)}${scenario.description}`);
  }

  return lines.join("\n");
}
