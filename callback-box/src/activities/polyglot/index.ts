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
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Activity, ActivityMode } from "../index.js";
import type { ActivityInstance, ActivityMcpConfig } from "../index.js";
import { applyPolyglotConfigure } from "./configure.js";

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

  mcpServer(): ActivityMcpConfig {
    const instanceRoot = this.instance.root;
    return createSdkMcpServer({
      name: "polyglot-setup",
      version: "0.2.0",
      tools: [
        tool(
          "configure",
          "Save the user's target language and proficiency level. Call this once you've established both; after this call, the user can switch into main mode to start learning.",
          {
            language: z
              .string()
              .min(1)
              .describe("The language the user wants to learn, e.g. 'Spanish'"),
            level: z
              .enum(["beginner", "elementary", "intermediate", "advanced", "fluent"])
              .describe("The user's current proficiency level"),
          },
          async ({ language, level }) => {
            const state = await applyPolyglotConfigure({
              instanceRoot,
              input: { language, level },
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Configured: ${state.language} at ${state.level} level. Tell the user they can now switch to main mode to start learning.`,
                },
              ],
            };
          },
        ),
      ],
    });
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
