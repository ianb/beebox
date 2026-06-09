/**
 * Per-machine state metadata for SSR rendering scenarios.
 *
 * Declares the sample context used to render each machine state without
 * live data. Consumed by the state registry's snapshot builders.
 */

import { chatMachine } from "../machines/chatMachine";
import { claudeAuthMachine } from "../machines/claudeAuthMachine";
import { speechPlaybackMachine } from "../machines/speechPlaybackMachine";
import { voiceRecorderMachine } from "../machines/voiceRecorderMachine";
import { realtimeTranscriptionMachine } from "../machines/realtimeTranscriptionMachine";
import type { SessionEntry, SessionContentBlock } from "../api";
import type { MachineStateInfo } from "./state-registry-types";

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
