/**
 * Polyglot — language-learning activity.
 *
 * First-pass implementation: setup mode is conversational (agent gathers
 * the target language + level and asks the user to write them to
 * `state.json`); main mode becomes available once `state.language` is set
 * and runs with a prompt that names the language + level.
 *
 * State mutation via MCP tools is a follow-up — for now the box owner
 * edits state directly.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Activity, ActivityMode } from "../index.js";
import type { ActivityInstance, MCPServerConfig } from "../index.js";

export interface PolyglotState {
  language: string | null;
  level: PolyglotLevel | null;
  createdAt: string;
}

export type PolyglotLevel =
  | "beginner"
  | "elementary"
  | "intermediate"
  | "advanced"
  | "fluent";

const __dirname = import.meta.dirname;
const SETUP_PROMPT_PATH = join(__dirname, "setup-prompt.md");
const SETUP_MCP_SCRIPT_PATH = join(__dirname, "setup-mcp.ts");
const INSTANCE_CLAUDE_TEMPLATE_PATH = join(__dirname, "instance-claude-template.md");

async function readPolyglotState(instance: ActivityInstance): Promise<PolyglotState> {
  return instance.readJson<PolyglotState>("state.json");
}

export class PolyglotSetupMode extends ActivityMode {
  async systemPrompt(): Promise<string> {
    return readFile(SETUP_PROMPT_PATH, "utf-8");
  }

  available(): boolean {
    return true;
  }

  mcpServer(): MCPServerConfig {
    return {
      command: "tsx",
      args: [SETUP_MCP_SCRIPT_PATH],
      env: {},
    };
  }
}

export class PolyglotMainMode extends ActivityMode {
  readonly isDefault = true;

  async systemPrompt(): Promise<string> {
    const state = await readPolyglotState(this.instance);
    if (state.language === null) {
      // Shouldn't reach here — `available()` gates entry — but fail loud if it does.
      throw new Error(
        `PolyglotMainMode.systemPrompt: language not set on instance ${this.instance.root}`,
      );
    }
    const level = state.level ?? "unspecified";
    return [
      `You are a language tutor. The user is learning ${state.language} at a`,
      `${level} level. Keep responses conversational. Mix ${state.language}`,
      "and the user's language appropriately for their level, and gently",
      `correct mistakes when they try to write in ${state.language}.`,
      "",
      "This is a first-pass implementation — there are no flashcards, no",
      "progress tracking, no lesson structure yet. Just talk.",
    ].join("\n");
  }

  async available(): Promise<boolean> {
    try {
      const state = await readPolyglotState(this.instance);
      return state.language !== null;
    } catch {
      return false;
    }
  }
}

export class Polyglot extends Activity {
  readonly type = "polyglot";
  readonly metadata = {
    title: "Polyglot",
    description: "Learn a language through conversation",
    iconDescription: "A globe",
    singleton: false,
  };
  readonly modes = { setup: PolyglotSetupMode, main: PolyglotMainMode };

  async seedInstance(
    instance: ActivityInstance,
    ctx: { displayName: string },
  ): Promise<void> {
    const initialState: PolyglotState = {
      language: null,
      level: null,
      createdAt: new Date().toISOString(),
    };
    await instance.writeJson("state.json", initialState);

    const template = await readFile(INSTANCE_CLAUDE_TEMPLATE_PATH, "utf-8");
    const rendered = template.replace(/{displayName}/g, ctx.displayName);
    await instance.writeText("CLAUDE.md", rendered);
  }
}
