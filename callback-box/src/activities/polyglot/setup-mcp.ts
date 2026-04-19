#!/usr/bin/env node
/**
 * MCP server for Polyglot's setup mode.
 *
 * Exposes one tool, `configure(language, level)`, which writes the
 * instance's target language and proficiency level to `state.json`.
 * Once written, the `main` mode's `available()` flips to true.
 *
 * Launched as a subprocess by the chat layer. Reads `CB_ACTIVITY_ROOT`
 * from env to know which instance directory to operate on.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { applyPolyglotConfigure } from "./configure.js";

const instanceRoot = process.env["CB_ACTIVITY_ROOT"];
if (instanceRoot === undefined || instanceRoot === "") {
  console.error("polyglot setup-mcp: CB_ACTIVITY_ROOT is not set");
  process.exit(1);
}

const server = new McpServer({
  name: "polyglot-setup",
  version: "0.1.0",
});

server.registerTool(
  "configure",
  {
    description:
      "Save the user's target language and proficiency level. Call this once you've established both; after this call, the user can switch into main mode to start learning.",
    inputSchema: {
      language: z
        .string()
        .min(1)
        .describe("The language the user wants to learn, e.g. 'Spanish'"),
      level: z
        .enum(["beginner", "elementary", "intermediate", "advanced", "fluent"])
        .describe("The user's current proficiency level"),
    },
  },
  async ({ language, level }) => {
    const state = await applyPolyglotConfigure({ instanceRoot, input: { language, level } });
    return {
      content: [
        {
          type: "text",
          text: `Configured: ${state.language} at ${state.level} level. Tell the user they can now switch to main mode to start learning.`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
